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
  assert.deepEqual(unsupported, [{ phone: "+919000000001", providerMessageId: "wamid.2" }]);
});

test("status-only callbacks and malformed payloads parse to nothing, not a crash", () => {
  assert.deepEqual(parseInbound(envelope([])), { texts: [], unsupported: [] });
  assert.deepEqual(parseInbound({ nonsense: true }), { texts: [], unsupported: [] });
  assert.deepEqual(parseInbound(null), { texts: [], unsupported: [] });
});
