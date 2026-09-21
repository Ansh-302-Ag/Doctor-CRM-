/**
 * The Baileys gateway's reason to be trusted.
 *
 * The gateway holds a live WhatsApp socket, so it cannot be tested here. What
 * can — and what the whole design rests on — is the contract: that what the
 * gateway emits is byte-for-byte something the app's own verifySignature and
 * parseInbound accept, and that it resolves to the right patient. If that
 * holds, pointing the app at the gateway needs no app-side code at all.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { verifySignature, parseInbound } from "../src/lib/webhook";
import { signBody, senderPhone, toMetaEnvelope } from "../whatsapp-gateway/envelope.js";

const SECRET = "gateway-app-secret";

/** Exactly what whatsapp-gateway/index.js does: serialize once, sign that
 *  string, post that string. */
function deliver(msg: unknown) {
  const envelope = toMetaEnvelope(msg);
  if (!envelope) return null;
  const raw = JSON.stringify(envelope);
  return { raw, signature: signBody(raw, SECRET) };
}

/** A message as Baileys hands it over, trimmed to the fields we read. */
const baileysMessage = (over: Record<string, unknown> = {}) => ({
  key: { remoteJid: "919000000001@s.whatsapp.net", fromMe: false, id: "3EB0A1B2C3D4E5" },
  messageTimestamp: 1758400000,
  pushName: "Asha",
  message: { conversation: "I need an appointment with Dr. Rao" },
  ...over,
});

test("a Baileys text message arrives as a signed, parseable inbound text", () => {
  process.env.WHATSAPP_APP_SECRET = SECRET;
  try {
    const sent = deliver(baileysMessage())!;
    assert.equal(verifySignature(sent.raw, sent.signature), true);
    assert.deepEqual(parseInbound(JSON.parse(sent.raw)).texts, [{
      phone: "+919000000001",
      body: "I need an appointment with Dr. Rao",
      providerMessageId: "3EB0A1B2C3D4E5",
    }]);
  } finally { delete process.env.WHATSAPP_APP_SECRET; }
});

test("a reply-quoted text (extendedTextMessage) is read the same way", () => {
  const sent = deliver(baileysMessage({
    message: { extendedTextMessage: { text: "tomorrow at 4", contextInfo: { stanzaId: "x" } } },
  }))!;
  assert.equal(parseInbound(JSON.parse(sent.raw)).texts[0].body, "tomorrow at 4");
});

test("a disappearing message is unwrapped rather than lost", () => {
  const sent = deliver(baileysMessage({
    message: { ephemeralMessage: { message: { conversation: "please cancel" } } },
  }))!;
  assert.equal(parseInbound(JSON.parse(sent.raw)).texts[0].body, "please cancel");
});

test("a photo reaches the app's unsupported path, with the patient still identified", () => {
  const sent = deliver(baileysMessage({
    key: { remoteJid: "919000000002@s.whatsapp.net", fromMe: false, id: "3EB0IMG" },
    message: { imageMessage: { mimetype: "image/jpeg", caption: "" } },
  }))!;
  const { texts, unsupported } = parseInbound(JSON.parse(sent.raw));
  assert.equal(texts.length, 0);
  assert.deepEqual(unsupported, [{ phone: "+919000000002", providerMessageId: "3EB0IMG" }]);
});

test("audio and location are forwarded with their real type, never dropped", () => {
  for (const [message, type] of [
    [{ audioMessage: { mimetype: "audio/ogg", ptt: true } }, "audio"],
    [{ locationMessage: { degreesLatitude: 12.9, degreesLongitude: 77.6 } }, "location"],
  ] as const) {
    const sent = deliver(baileysMessage({ message }))!;
    const value = JSON.parse(sent.raw).entry[0].changes[0].value;
    assert.equal(value.messages[0].type, type);
    assert.equal(parseInbound(JSON.parse(sent.raw)).unsupported.length, 1);
  }
});

test("a tampered body or a wrong secret is rejected by the app's own check", () => {
  process.env.WHATSAPP_APP_SECRET = SECRET;
  try {
    const sent = deliver(baileysMessage())!;
    assert.equal(verifySignature(sent.raw, signBody(sent.raw, "not-the-secret")), false);

    // Same signature, a different patient's number swapped into the body:
    // the case the signature exists to stop.
    const forged = sent.raw.replace("919000000001", "919000000009");
    assert.notEqual(forged, sent.raw);
    assert.equal(verifySignature(forged, sent.signature), false);
    assert.equal(verifySignature(sent.raw, null), false);
  } finally { delete process.env.WHATSAPP_APP_SECRET; }
});

test("a @lid sender is resolved to the real number, never forwarded as a @lid", () => {
  const sent = deliver(baileysMessage({
    key: {
      remoteJid: "123456789012345@lid",
      senderPn: "919000000003@s.whatsapp.net",
      fromMe: false,
      id: "3EB0LID",
    },
  }))!;
  assert.equal(parseInbound(JSON.parse(sent.raw)).texts[0].phone, "+919000000003");
});

test("a @lid with no phone number behind it is dropped, not turned into a patient", () => {
  const msg = baileysMessage({
    key: { remoteJid: "123456789012345@lid", fromMe: false, id: "3EB0LIDONLY" },
  });
  assert.equal(senderPhone(msg.key), null);
  assert.equal(toMetaEnvelope(msg), null);
});

test("our own messages, groups and reactions are not forwarded", () => {
  assert.equal(toMetaEnvelope(baileysMessage({
    key: { remoteJid: "919000000001@s.whatsapp.net", fromMe: true, id: "a" } })), null);
  assert.equal(toMetaEnvelope(baileysMessage({
    key: { remoteJid: "12036300@g.us", fromMe: false, id: "b" } })), null);
  assert.equal(toMetaEnvelope(baileysMessage({
    message: { reactionMessage: { text: "\u{1F44D}" } } })), null);
  assert.equal(toMetaEnvelope(baileysMessage({
    message: { protocolMessage: { type: 0 } } })), null);
});

test("a device-suffixed JID still yields the bare number", () => {
  assert.equal(senderPhone({ remoteJid: "919000000001:12@s.whatsapp.net" }), "919000000001");
});
