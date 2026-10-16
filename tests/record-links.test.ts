/**
 * Secure prescription links (src/lib/record-links.ts): hashed tokens, one-time
 * codes, limits, and the rule that no WhatsApp message carries health content.
 */
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { db, agentDb, reset, seed, closeAll, type Fixture } from "./helpers";
import {
  createRecordLink, issueCode, verifyCode, readRecord, linkPreview, sendRecordCode, codeMessage,
  MAX_WRONG_CODES,
} from "../src/lib/record-links";
import { TEMPLATES } from "../src/lib/templates";
import { tools } from "../src/lib/agent/tools";
import { prescribeAndNotify } from "../src/lib/doctor";
import { handleInbound } from "../src/lib/agent";
import { scripted } from "./stub-classifier";

let f: Fixture;
beforeEach(async () => { await reset(); f = await seed(); });
after(closeAll);

const MIN = 60_000;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const isPermissionDenied = (e: unknown) => (e as { code?: string }).code === "42501";

const RX = { drug: "Amoxicillin", dosage: "500mg twice daily", days: 5, notes: "after food" };
async function prescribe(status = "active") {
  await db`insert into prescriptions (patient_id, doctor_id, drug_name, dosage, duration_days, notes, status, created_by)
           values (${f.patientId}, ${f.doctorId}, ${RX.drug}, ${RX.dosage}, ${RX.days}, ${RX.notes},
                   ${status}::prescription_status, ${f.doctorUserId})`;
}

/** The code value: issueCode returns it to its caller (which sends it), so the
 *  tests read it there — the database only ever holds its hash. */
async function code(token: string, now = new Date()) {
  const r = await issueCode(db, token, now);
  assert.ok(r.ok, "code issued");
  return r.code;
}

test("a link stores only a hash of its token", async () => {
  const { token, url, expiresAt } = await createRecordLink(db, f.patientId);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/, "32 random bytes, base64url");
  assert.ok(url.endsWith(`/r/${token}`));
  const [row] = await db<{ token_hash: string; expires_at: Date }[]>`select token_hash, expires_at from record_links`;
  assert.notEqual(row.token_hash, token);
  assert.equal(row.token_hash, sha256(token));
  assert.equal(row.expires_at.getTime(), expiresAt.getTime());
  assert.ok(Math.abs(expiresAt.getTime() - Date.now() - 7 * 24 * 60 * MIN) < MIN, "seven days");
});

test("a code is issued for a live link, stored only as a hash, and verifies once", async () => {
  const { token } = await createRecordLink(db, f.patientId);
  const c = await code(token);
  assert.match(c, /^\d{6}$/);
  const [row] = await db<{ code_hash: string }[]>`select code_hash from record_links`;
  assert.equal(row.code_hash, sha256(c));

  const ok = await verifyCode(db, token, c);
  assert.ok(ok.ok);
  assert.equal(ok.patientId, f.patientId);
  assert.equal((await verifyCode(db, token, c)).ok, false, "single use");
  assert.equal(((await verifyCode(db, token, c)) as { reason: string }).reason, "no_code",
    "once used, no code is outstanding");
});

test("a new code replaces the previous one", async () => {
  const { token } = await createRecordLink(db, f.patientId);
  const first = await code(token);
  const second = await code(token);
  if (second !== first) {  // equal one time in a million
    assert.equal(((await verifyCode(db, token, first)) as { reason: string }).reason, "wrong_code");
  }
  assert.ok((await verifyCode(db, token, second)).ok);
});

test("a wrong or altered token is invalid", async () => {
  const { token } = await createRecordLink(db, f.patientId);
  const altered = (token[0] === "A" ? "B" : "A") + token.slice(1);
  assert.deepEqual(await issueCode(db, altered), { ok: false, reason: "invalid" });
  assert.deepEqual(await verifyCode(db, altered, "123456"), { ok: false, reason: "invalid" });
  assert.equal(await linkPreview(db, altered), null);
  assert.equal(await linkPreview(db, "x".repeat(5000)), null);
});

test("an expired link, a deleted patient, or withdrawn consent kills the link", async () => {
  const a = await createRecordLink(db, f.patientId, new Date(Date.now() - 8 * 24 * 60 * MIN));
  assert.deepEqual(await issueCode(db, a.token), { ok: false, reason: "invalid" });
  assert.equal(await linkPreview(db, a.token), null);

  const b = await createRecordLink(db, f.patientId);
  const c = await code(b.token);
  await db`update patients set deleted_at = now() where id = ${f.patientId}`;
  assert.deepEqual(await issueCode(db, b.token), { ok: false, reason: "invalid" });
  assert.deepEqual(await verifyCode(db, b.token, c), { ok: false, reason: "invalid" });

  const o = await createRecordLink(db, f.otherPatientId);
  await db`update patients set consent_status = 'withdrawn' where id = ${f.otherPatientId}`;
  assert.deepEqual(await issueCode(db, o.token), { ok: false, reason: "invalid" });
  assert.equal(await linkPreview(db, o.token), null);
});

test("five wrong codes lock the link, and the right code after that still fails", async () => {
  const { token } = await createRecordLink(db, f.patientId);
  const c = await code(token);
  const wrong = c === "000000" ? "111111" : "000000";
  for (let i = 1; i < MAX_WRONG_CODES; i++) {
    assert.deepEqual(await verifyCode(db, token, wrong),
      { ok: false, reason: "wrong_code", triesLeft: MAX_WRONG_CODES - i });
  }
  assert.deepEqual(await verifyCode(db, token, wrong), { ok: false, reason: "locked" }, "the fifth locks");
  assert.deepEqual(await verifyCode(db, token, c), { ok: false, reason: "locked" });
  assert.deepEqual(await issueCode(db, token), { ok: false, reason: "invalid" }, "no new code either");
  assert.equal(await linkPreview(db, token), null);
});

test("a code expires after ten minutes", async () => {
  const now = new Date();
  const { token } = await createRecordLink(db, f.patientId, now);
  const c = await code(token, now);
  assert.deepEqual(await verifyCode(db, token, c, new Date(now.getTime() + 11 * MIN)),
    { ok: false, reason: "expired_code" });
  assert.ok((await verifyCode(db, token, c, new Date(now.getTime() + 9 * MIN))).ok);
});

test("no more than three codes an hour", async () => {
  const now = new Date();
  const { token } = await createRecordLink(db, f.patientId, now);
  for (let i = 0; i < 3; i++) await code(token, new Date(now.getTime() + i * MIN));
  assert.deepEqual(await issueCode(db, token, new Date(now.getTime() + 30 * MIN)),
    { ok: false, reason: "rate_limited" });
  assert.ok((await issueCode(db, token, new Date(now.getTime() + 61 * MIN))).ok, "the oldest has aged out");
});

test("reading the record writes a patient audit row and returns the doctor's words unchanged", async () => {
  await prescribe();
  await prescribe("discontinued");
  const { token } = await createRecordLink(db, f.patientId);
  const v = await verifyCode(db, token, await code(token));
  assert.ok(v.ok);

  const r = await readRecord(db, v.linkId);
  assert.ok(r);
  assert.equal(r.clinicName, "Test Clinic");
  assert.equal(r.patientName, "Asha");
  assert.equal(r.patientPhone, "+919000000001");
  assert.equal(r.timezone, "Asia/Kolkata");
  assert.equal(r.prescriptions.length, 1, "active prescriptions only");
  const [p] = r.prescriptions;
  assert.deepEqual(
    { drugName: p.drugName, dosage: p.dosage, durationDays: p.durationDays, notes: p.notes,
      status: p.status, doctorName: p.doctorName },
    { drugName: RX.drug, dosage: RX.dosage, durationDays: RX.days, notes: RX.notes,
      status: "active", doctorName: "Dr. Rao" });
  assert.ok(p.createdAt instanceof Date);

  const audits = await db<{ actor: string; action: string; target_id: string }[]>`
    select actor, action, target_id from audit_log`;
  assert.deepEqual([...audits], [
    { actor: `patient:${f.patientId}`, action: "read_prescription", target_id: f.patientId }]);

  await db`update patients set deleted_at = now() where id = ${f.patientId}`;
  assert.equal(await readRecord(db, v.linkId), null, "a verified view dies with the link");
});

test("the agent role can create a link but cannot read link rows back", async () => {
  await prescribe();
  const url = await tools.prescription_link(agentDb, f.patientId);
  assert.match(url!, /\/r\/[A-Za-z0-9_-]{43}$/);
  await assert.rejects(agentDb`select token_hash, code_hash from record_links`, isPermissionDenied);
  await assert.rejects(agentDb`update record_links set locked_at = null`, isPermissionDenied);
  assert.equal(await tools.prescription_link(agentDb, f.otherPatientId), null, "nothing active, no link");
});

test("in production a missing APP_URL refuses to build a link", async () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { node: env.NODE_ENV, app: env.APP_URL };
  env.NODE_ENV = "production"; delete env.APP_URL;
  try {
    await assert.rejects(createRecordLink(db, f.patientId), /APP_URL/);
  } finally {
    env.NODE_ENV = saved.node;
    if (saved.app === undefined) delete env.APP_URL; else env.APP_URL = saved.app;
  }
  assert.equal((await db`select 1 from record_links`).length, 0);
});

/** Records what the channel was asked to send, without sending anything. */
function spy() {
  const free: { to: string; text: string }[] = [];
  const templates: { to: string; name: string; parameters: string[] }[] = [];
  return {
    free, templates,
    send: async (m: { to: string; text: string }) => { free.push(m); return { delivered: true }; },
    sendT: async (m: { to: string; name: string; parameters: string[] }) => {
      templates.push(m); return { delivered: true };
    },
  };
}

async function patientMessagedAgo(hours: number, now: Date) {
  await db`insert into messages (conversation_id, direction, body, created_at)
           values (${f.conversationId}, 'inbound', 'hello', ${new Date(now.getTime() - hours * 3_600_000)})`;
}

test("inside the window the code goes as free-form text; outside, as the authentication template", async () => {
  const now = new Date();
  const { token } = await createRecordLink(db, f.patientId, now);

  const outside = spy();
  assert.deepEqual(await sendRecordCode(db, token, now, outside), { ok: true, sent: true });
  assert.equal(outside.free.length, 0, "free-form outside the window would be refused by Meta");
  assert.equal(outside.templates[0].name, "record_code");
  assert.equal(outside.templates[0].to, "+919000000001");
  const c1 = outside.templates[0].parameters[0];
  assert.match(c1, /^\d{6}$/);

  await patientMessagedAgo(2, now);
  const inside = spy();
  assert.deepEqual(await sendRecordCode(db, token, now, inside), { ok: true, sent: true });
  assert.equal(inside.templates.length, 0);
  const c2 = inside.free[0].text.match(/\b(\d{6})\b/)![1];
  assert.equal(inside.free[0].text, codeMessage("Test Clinic", c2));
  assert.ok((await verifyCode(db, token, c2, now)).ok, "the code sent is the code that works");

  const failing = await sendRecordCode(db, token, now, { send: async () => { throw new Error("502"); } });
  assert.deepEqual(failing, { ok: true, sent: false }, "a channel failure is reported, not thrown");
  assert.deepEqual(await sendRecordCode(db, token, now, spy()), { ok: false, reason: "rate_limited" });
});

test("no WhatsApp message — template or free-form — carries the prescription", async () => {
  await prescribe();
  await db`insert into appointments (clinic_id, doctor_id, patient_id, starts_at, ends_at, created_by)
           values (${f.clinicId}, ${f.doctorId}, ${f.patientId}, now(), now() + interval '30 minutes', 'agent')`;
  const doctor = { id: f.doctorUserId, role: "doctor" as const, clinicId: f.clinicId,
                   doctorId: f.doctorId, timezone: "Asia/Kolkata" };
  const rx = { patientId: f.patientId, doctorId: f.doctorId, drugName: RX.drug, dosage: RX.dosage,
               durationDays: RX.days, notes: RX.notes };
  const bodies: string[] = Object.values(TEMPLATES).map(t => t.bodyText);
  const now = new Date();

  // Outside the window: the prescription_ready template and the code template.
  const out = spy();
  await prescribeAndNotify(db, doctor, rx, { ...out, now });
  const { token } = await createRecordLink(db, f.patientId, now);
  await sendRecordCode(db, token, now, out);
  bodies.push(...out.templates.map(t => t.parameters.join("\n")));

  // Inside the window: the free-form prescription note, the code, the agent's reply.
  await patientMessagedAgo(1, now);
  const inn = spy();
  await prescribeAndNotify(db, doctor, rx, { ...inn, now });
  await sendRecordCode(db, token, now, inn);
  bodies.push(...inn.free.map(m => m.text));
  const reply = await handleInbound(db, {
    clinicId: f.clinicId, phone: "+919000000001", body: "what is my prescription",
    providerMessageId: "wamid.rx",
  }, now, scripted);
  bodies.push(reply!.text);

  assert.equal(bodies.length, Object.keys(TEMPLATES).length + 2 + 3);
  for (const body of bodies) {
    for (const s of [RX.drug, RX.dosage, "500mg", `${RX.days} day`, RX.notes]) {
      assert.ok(!body.includes(s), `"${s}" in: ${body}`);
    }
    assert.doesNotMatch(body, /\b(dosage|tablet|medicine|drug)s?\b/i, body);
  }
});

test("a double submit of the right code verifies once and is not counted as a wrong code", async () => {
  const { token } = await createRecordLink(db, f.patientId);
  const c = await code(token);
  const results = await Promise.all([verifyCode(db, token, c), verifyCode(db, token, c)]);
  assert.equal(results.filter(r => r.ok).length, 1, "exactly one verifies");
  const other = results.find(r => !r.ok) as { reason: string };
  // Which one depends on timing: it saw the code and lost the consume
  // (already used), or read the row after the winner consumed it (none out).
  assert.ok(["expired_code", "no_code"].includes(other.reason), `already used, not wrong: ${other.reason}`);
  const [row] = await db<{ wrong_codes: number }[]>`select wrong_codes from record_links`;
  assert.equal(row.wrong_codes, 0);
});

test("with no code outstanding, guesses are refused but never count toward the lock", async () => {
  const { token } = await createRecordLink(db, f.patientId);
  for (let i = 0; i < MAX_WRONG_CODES + 1; i++) {
    assert.deepEqual(await verifyCode(db, token, "123456"), { ok: false, reason: "no_code" });
  }
  const [row] = await db<{ wrong_codes: number; locked_at: Date | null }[]>`
    select wrong_codes, locked_at from record_links`;
  assert.deepEqual({ ...row }, { wrong_codes: 0, locked_at: null });
  assert.ok((await verifyCode(db, token, await code(token))).ok, "the link still works");
});
