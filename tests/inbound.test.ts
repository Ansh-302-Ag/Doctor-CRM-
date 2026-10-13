/**
 * Per-message webhook processing (docs/08): what the patient is told and who is
 * paged when a send fails, a message cannot be read, or cannot be attributed.
 */
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, reset, seed, closeAll, type Fixture } from "./helpers";
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
