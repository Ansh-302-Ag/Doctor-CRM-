/**
 * Per-message webhook processing (docs/08): what the patient is told and who is
 * paged when a send fails, a message cannot be read, or cannot be attributed.
 */
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, agentDb, reset, seed, closeAll, type Fixture } from "./helpers";
import { processWebhook, type Senders } from "../src/lib/inbound";
import { scripted } from "./stub-classifier";
import type { Outbound, StaffAlert } from "../src/lib/channel";

let f: Fixture;
beforeEach(async () => { await reset(); f = await seed(); });
after(closeAll);

const envelope = (messages: unknown[]) =>
  ({ entry: [{ changes: [{ value: { messages } }] }] });

const text = (body: string, id = "w1") =>
  ({ from: "919000000001", id, type: "text", text: { body } });

/** Senders that record every call, in order, and can be told to throw. */
function recorder(opts: { sendThrows?: boolean } = {}) {
  const calls: ({ kind: "send"; m: Outbound } | { kind: "page"; a: StaffAlert })[] = [];
  const senders: Senders = {
    async sendMessage(m) {
      calls.push({ kind: "send", m });
      if (opts.sendThrows) throw new Error("whatsapp send failed: 500");
      return { delivered: true };
    },
    async notifyStaff(a) { calls.push({ kind: "page", a }); },
  };
  const sends = () => calls.flatMap(c => c.kind === "send" ? [c.m] : []);
  const pages = () => calls.flatMap(c => c.kind === "page" ? [c.a] : []);
  return { calls, senders, sends, pages };
}

const run = (payload: unknown, r: ReturnType<typeof recorder>) =>
  processWebhook(db, payload, f.clinicId, r.senders, scripted);

/** The real pool, except every transaction fails: a processing failure that no
 *  message content can route around (an emergency never reaches a timezone). */
const failing = new Proxy(db, {
  get: (t, k) => k === "begin"
    ? async () => { throw new Error("database unavailable"); }
    : Reflect.get(t, k),
});

test("an emergency that hits a processing failure still gets 112 and an urgent page", async () => {
  const r = recorder();
  await processWebhook(failing, envelope([text("chest pain")]), f.clinicId, r.senders, scripted);

  assert.equal(r.sends().length, 1);
  assert.match(r.sends()[0].text, /112/);
  assert.equal(r.pages().length, 1);
  assert.equal(r.pages()[0].urgent, true);
  assert.match(r.pages()[0].note, /^URGENT: /);
  const e = await db<{ priority: string }[]>`select priority from escalations`;
  assert.deepEqual(e.map(x => x.priority), ["emergency"]);
});

const escalationRows = () => db<{ reason: string; patient_id: string; conversation_id: string }[]>`
  select reason, patient_id, conversation_id from escalations`;

test("a reply that fails to send leaves a row in the inbox, not just a page", async () => {
  const r = recorder({ sendThrows: true });
  await run(envelope([text("I need an appointment with Dr. Rao")]), r);

  const rows = await escalationRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, "reply could not be delivered");
  assert.equal(rows[0].patient_id, f.patientId);
  assert.equal(rows[0].conversation_id, f.conversationId);
  assert.match(r.pages()[0].note, /Open the escalation inbox\.$/);
});

test("a message that could not be processed leaves a row in the inbox", async () => {
  // Fails inside the transaction, so everything the handler wrote is gone.
  // Run as the restricted role the webhook really uses: the row must not need
  // a grant the agent lacks.
  await db`update clinics set timezone = '' where id = ${f.clinicId}`;
  const r = recorder();
  await processWebhook(agentDb, envelope([text("I need an appointment with Dr. Rao")]),
    f.clinicId, r.senders, scripted);

  const rows = await escalationRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, "message could not be processed");
  assert.equal(rows[0].patient_id, f.patientId);
  assert.equal(r.pages().length, 1);
  assert.match(r.pages()[0].note, /Open the escalation inbox\.$/);
});

test("a first message that could not be processed still pages, with no row to attach", async () => {
  const r = recorder();
  await processWebhook(failing, envelope([
    { from: "919000000099", id: "n1", type: "text", text: { body: "hello" } },
  ]), f.clinicId, r.senders, scripted);

  assert.equal(r.pages().length, 1);
  assert.equal((await escalationRows()).length, 0);
});

test("a reply that fails to send does not tell the patient there was a technical issue", async () => {
  const r = recorder({ sendThrows: true });
  await run(envelope([text("I need an appointment with Dr. Rao")]), r);

  assert.equal(r.sends().length, 1, "no second, technical-failure send");
  assert.equal(r.pages().length, 1);
  assert.match(r.pages()[0].note, /could not be delivered/);
  assert.equal((await db`select id from messages where direction = 'outbound'`).length, 1);
});

test("an emergency caption on an image escalates as an emergency", async () => {
  const r = recorder();
  await run(envelope([
    { from: "919000000001", id: "m1", type: "image", image: { id: "m1", caption: "chest pain" } },
  ]), r);

  const e = await db<{ priority: string }[]>`select priority from escalations`;
  assert.equal(e.length, 1);
  assert.equal(e[0].priority, "emergency");
  assert.deepEqual(r.calls.map(c => c.kind), ["page", "send"], "staff are paged first");
  assert.equal(r.pages()[0].urgent, true);
  assert.match(r.sends()[0].text, /112/);
});

test("an image without caption gets the typed-messages reply, once, and pages nobody", async () => {
  const r = recorder();
  const image = { from: "919000000001", id: "img1", type: "image", image: { id: "x" } };
  await run(envelope([image]), r);
  await run(envelope([image]), r);

  assert.equal(r.sends().length, 1);
  assert.match(r.sends()[0].text, /only read typed messages/);
  assert.equal(r.pages().length, 0);
  const rows = await db<{ body: string }[]>`select body from messages where direction = 'inbound'`;
  assert.deepEqual(rows.map(x => x.body), ["[image]"]);
});

test("a reaction produces no reply and no page", async () => {
  const r = recorder();
  await run(envelope([
    { from: "919000000001", id: "r1", type: "reaction", reaction: { emoji: "x" } },
  ]), r);
  assert.equal(r.calls.length, 0);
});

test("staff pages never contain the patient's words or full number", async () => {
  const r = recorder();
  await run(envelope([text("can I take paracetamol with my BP medicine")]), r);

  assert.ok(r.pages().length > 0, "a clinical question pages staff");
  for (const p of r.pages()) {
    assert.doesNotMatch(p.note, /paracetamol/);
    assert.doesNotMatch(p.note, /919000000001/);
  }
});

test("a payload missing from is paged, not silently dropped", async () => {
  const r = recorder();
  await run(envelope([
    { from_user_id: "IN.123", id: "u1", type: "text", text: { body: "hello" } },
  ]), r);
  assert.equal(r.pages().length, 1);
  assert.match(r.pages()[0].note, /without a visible phone number/);
});
