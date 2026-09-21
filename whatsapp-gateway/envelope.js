/**
 * The contract between the Baileys gateway and Doctor CRM.
 *
 * The app already speaks the WhatsApp Cloud API (src/lib/webhook.ts,
 * src/lib/channel.ts), so this gateway speaks it too rather than inventing a
 * private protocol: the app needs no gateway-specific code, and going live on
 * real Meta is removing one env var.
 *
 * Kept out of index.js — which owns a live socket and cannot be tested — so the
 * app's own suite can assert that what we emit is what verifySignature and
 * parseInbound accept (tests/gateway-contract.test.ts).
 */
const { createHmac } = require("node:crypto");

/** Baileys content keys we forward, mapped to Meta's `type`. Anything absent
 *  here (reactions, protocol/edit/delete events, poll updates, key
 *  distribution) is not a message a receptionist can answer, so it is dropped
 *  rather than answered with "I can only read text messages". */
const MEDIA_TYPES = {
  imageMessage: "image",
  videoMessage: "video",
  audioMessage: "audio",
  documentMessage: "document",
  stickerMessage: "sticker",
  locationMessage: "location",
  contactMessage: "contacts",
};

/** Meta signs the exact bytes it POSTs. Callers serialize once and pass the
 *  same string here and to fetch(), or the HMAC will not match. */
function signBody(rawBody, secret) {
  return "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * The sender's phone number in Meta's form: digits, no leading "+".
 *
 * Newer WhatsApp addresses some chats by "linked ID" (`...@lid`) instead of a
 * phone number. A @lid is not a phone number: passing one through would key a
 * patient record to a value that never matches the real number, splitting one
 * patient's identity, consent and history in two. Baileys carries the real
 * number alongside it — `senderPn` on 6.x, `remoteJidAlt` on 7.x — so take
 * whichever field actually holds one, and if none does return null so the
 * caller drops the message loudly rather than inventing a patient.
 */
function senderPhone(key = {}) {
  const jid = [key.remoteJid, key.senderPn, key.remoteJidAlt]
    .find(j => typeof j === "string" && j.endsWith("@s.whatsapp.net"));
  // "919000000001:12@s.whatsapp.net" -> "919000000001" (the ":n" is a device id)
  return jid ? jid.split("@")[0].split(":")[0] : null;
}

/** Disappearing and view-once messages wrap the real content one level down. */
const unwrap = m =>
  m?.ephemeralMessage?.message ?? m?.viewOnceMessage?.message ??
  m?.viewOnceMessageV2?.message ?? m;

/** The `type` and `text` fields of a Meta message object, or null to drop. */
function content(message) {
  const text = message?.conversation ?? message?.extendedTextMessage?.text;
  if (typeof text === "string" && text !== "") return { type: "text", text: { body: text } };
  const media = Object.keys(message ?? {}).find(k => k in MEDIA_TYPES);
  return media ? { type: MEDIA_TYPES[media] } : null;
}

/**
 * A Baileys message as Meta's webhook envelope, or null if it is not ours to
 * forward (sent by us, a group, or an event with nothing to reply to).
 *
 * Non-text messages are forwarded with their real type and no `text`, which is
 * what routes them to the app's `unsupported` path — dropping them would leave
 * the patient with silence.
 */
function toMetaEnvelope(msg) {
  const key = msg?.key ?? {};
  if (key.fromMe) return null;
  if (typeof key.remoteJid === "string" && key.remoteJid.endsWith("@g.us")) return null;

  const from = senderPhone(key);
  const body = content(unwrap(msg?.message));
  if (!from || !body || !key.id) return null;

  return {
    entry: [{ changes: [{ field: "messages", value: {
      messages: [{ from, id: key.id, ...body }],
    } }] }],
  };
}

module.exports = { signBody, senderPhone, toMetaEnvelope };
