import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifySignature, parseInbound } from "../src/lib/webhook";

const body = JSON.stringify({ hello: "world" });
const sign = (secret: string, b = body) =>
  "sha256=" + createHmac("sha256", secret).update(b, "utf8").digest("hex");

test("a correctly signed body is accepted and a tampered one is not", () => {
  process.env.WHATSAPP_APP_SECRET = "s3cret";
  try {
    assert.equal(verifySignature(body, sign("s3cret")), true);
    assert.equal(verifySignature(body, sign("wrong")), false);
    assert.equal(verifySignature(body + " ", sign("s3cret")), false);
    assert.equal(verifySignature(body, null), false);
    assert.equal(verifySignature(body, "garbage"), false);
  } finally { delete process.env.WHATSAPP_APP_SECRET; }
});

const envelope = (messages: unknown[]) =>
  ({ entry: [{ changes: [{ value: { messages } }] }] });

test("text messages are extracted with their provider id", () => {
  const { texts } = parseInbound(envelope([
    { from: "919000000001", id: "wamid.1", type: "text", text: { body: "hi" } },
  ]));
  assert.deepEqual(texts, [
    { phone: "+919000000001", body: "hi", providerMessageId: "wamid.1" },
  ]);
});

test("non-text messages are reported as unsupported, never dropped", () => {
  const { texts, unsupported } = parseInbound(envelope([
    { from: "919000000001", id: "wamid.2", type: "image" },
  ]));
  assert.equal(texts.length, 0);
  assert.deepEqual(unsupported, [{ phone: "+919000000001", providerMessageId: "wamid.2", kind: "image" }]);
});

test("status-only callbacks and malformed payloads parse to nothing, not a crash", () => {
  assert.deepEqual(parseInbound(envelope([])), { texts: [], unsupported: [], failed: [], unidentified: 0 });
  assert.deepEqual(parseInbound({ nonsense: true }), { texts: [], unsupported: [], failed: [], unidentified: 0 });
  assert.deepEqual(parseInbound(null), { texts: [], unsupported: [], failed: [], unidentified: 0 });
});

test("a message without from is counted, and does not discard its neighbour", () => {
  const r = parseInbound(envelope([
    { from: "919000000001", id: "w1", type: "text", text: { body: "hi" } },
    { from_user_id: "IN.123", id: "w2", type: "text", text: { body: "hello" } },
  ]));
  assert.equal(r.texts.length, 1);
  assert.equal(r.texts[0].providerMessageId, "w1");
  assert.equal(r.unidentified, 1);
});

test("reactions and system messages are ignored", () => {
  assert.deepEqual(parseInbound(envelope([
    { from: "919000000001", id: "w1", type: "reaction", reaction: { emoji: "x" } },
    { from: "919000000001", id: "w2", type: "system", system: { body: "changed number" } },
  ])), { texts: [], unsupported: [], failed: [], unidentified: 0 });
});

test("an edit arrives as unsupported with kind edit", () => {
  const { unsupported } = parseInbound(envelope([
    { from: "919000000001", id: "w1", type: "unsupported", unsupported: { type: "edit" } },
  ]));
  assert.equal(unsupported[0].kind, "edit");
});

test("a media caption is read as text", () => {
  const { texts, unsupported } = parseInbound(envelope([
    { from: "919000000001", id: "w1", type: "image", image: { id: "m1", caption: "severe chest pain" } },
    { from: "919000000001", id: "w2", type: "image", image: { id: "m2" } },
  ]));
  assert.equal(texts[0].body, "severe chest pain");
  assert.equal(texts[0].attachment, "image", "so the reply can say the image went unseen");
  assert.equal(unsupported[0].kind, "image");
});

test("failed delivery statuses are surfaced", () => {
  const wrap = (status: string) => ({ entry: [{ changes: [{ value: { statuses: [
    { id: "wamid.out", status, recipient_id: "919000000001", errors: [{ code: 131047, title: "Re-engagement message" }] },
  ] } }] }] });
  assert.deepEqual(parseInbound(wrap("failed")).failed, [
    { messageId: "wamid.out", recipient: "919000000001", code: 131047, title: "Re-engagement message" },
  ]);
  assert.deepEqual(parseInbound(wrap("delivered")).failed, []);
});
