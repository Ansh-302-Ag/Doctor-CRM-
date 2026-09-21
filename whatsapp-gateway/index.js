/**
 * Unofficial WhatsApp gateway for Doctor CRM, built on Baileys.
 *
 * It is an adapter, not a second brain: it owns the WhatsApp socket and
 * nothing else. On the app-facing side it speaks the WhatsApp Cloud API —
 * inbound it POSTs Meta's signed webhook envelope to the app's existing route,
 * outbound it serves Meta's /<phone-number-id>/messages endpoint. So the app
 * runs the same code path here as it does against real Meta.
 *
 * Unofficial: WhatsApp may rate-limit or ban the linked number. Use a
 * dedicated SIM. Production goes through the Meta Cloud API — see the README.
 */
const { timingSafeEqual } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const pino = require("pino");
const qrcode = require("qrcode-terminal");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const { signBody, senderPhone, toMetaEnvelope } = require("./envelope");

const WEBHOOK_URL = process.env.GATEWAY_WEBHOOK_URL ||
  "http://localhost:3000/api/webhook/whatsapp";
const SESSION_DIR = process.env.GATEWAY_SESSION_DIR ||
  path.join(__dirname, "auth");
const PORT = Number(process.env.GATEWAY_PORT || 3001);

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

/**
 * Both secrets are mandatory. Unsigned webhooks would let anyone POST claiming
 * any patient's number and book, cancel or erase a stranger's record; an
 * unauthenticated send endpoint would let anyone message the clinic's patients
 * as the clinic. There is no development shortcut around either.
 */
const APP_SECRET = required("WHATSAPP_APP_SECRET");
const TOKEN = required("WHATSAPP_TOKEN");

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set — refusing to start. See .env.example.`);
    process.exit(1);
  }
  return value;
}

/** Keep the last two digits, as src/lib/channel.ts does: enough to tie a log
 *  line to a conversation you already have, and nothing to anyone else. */
const mask = phone => `${"*".repeat(Math.max(0, phone.length - 2))}${phone.slice(-2)}`;

let sock = null;

async function forward(envelope) {
  // Serialize once: Meta signs the exact bytes, so the signed string and the
  // posted string must be the same string.
  const raw = JSON.stringify(envelope);
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": signBody(raw, APP_SECRET),
    },
    body: raw,
  });
  if (!res.ok) logger.error({ status: res.status }, "webhook_rejected");
}

async function startSocket() {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({ version, auth: state, logger: pino({ level: "silent" }) });
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      logger.info("Scan this with WhatsApp → Settings → Linked Devices:");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") logger.info("whatsapp_connected");
    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        logger.error(`Logged out. Delete ${SESSION_DIR} and restart to scan a new QR code.`);
        return;
      }
      logger.warn({ statusCode }, "connection_closed_reconnecting");
      startSocket().catch(err => logger.error({ err: err.message }, "reconnect_failed"));
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        // A @lid with no phone number behind it must never reach the app as a
        // sender — it would corrupt patient identity. Loud, because the patient
        // is now waiting on a reply that will not come.
        if (!msg.key?.fromMe && !msg.key?.remoteJid?.endsWith("@g.us") &&
            !senderPhone(msg.key)) {
          logger.error({ remoteJid: msg.key?.remoteJid },
            "dropped a message addressed by linked id with no phone number — " +
            "the sender cannot be identified, so nobody will reply to them");
          continue;
        }
        const envelope = toMetaEnvelope(msg);
        if (!envelope) continue;
        const [m] = envelope.entry[0].changes[0].value.messages;
        logger.info({ from: mask(m.from), type: m.type }, "inbound");
        await forward(envelope);
      } catch (err) {
        logger.error({ err: err.message }, "inbound_failed");
      }
    }
  });
}

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok", connected: Boolean(sock) }));

/**
 * Meta's send endpoint. src/lib/channel.ts already posts exactly this body to
 * exactly this path with exactly this header, so pointing WHATSAPP_API_BASE
 * here is the whole integration.
 */
app.post("/:phoneNumberId/messages", async (req, res) => {
  if (!bearerOk(req.headers.authorization)) {
    return res.status(401).json({ error: { message: "invalid access token", type: "OAuthException" } });
  }
  const { to, type = "text", text } = req.body ?? {};
  if (!sock) return res.status(503).json({ error: { message: "whatsapp socket not ready" } });
  if (type !== "text" || !to || !text?.body) {
    // Templates are resolved by Meta, not by Baileys; channel.ts sends their
    // rendered text instead whenever WHATSAPP_API_BASE is set.
    return res.status(400).json({ error: { message: "only { to, type: 'text', text: { body } } is supported" } });
  }

  const jid = `${String(to).replace(/\D/g, "")}@s.whatsapp.net`;
  try {
    const sent = await sock.sendMessage(jid, { text: text.body });
    logger.info({ to: mask(String(to)) }, "outbound");
    res.json({
      messaging_product: "whatsapp",
      contacts: [{ input: String(to), wa_id: jid.split("@")[0] }],
      messages: [{ id: sent?.key?.id }],
    });
  } catch (err) {
    logger.error({ err: err.message }, "send_failed");
    res.status(502).json({ error: { message: err.message } });
  }
});

function bearerOk(header) {
  const given = Buffer.from(String(header ?? "").replace(/^Bearer /, ""));
  const expected = Buffer.from(TOKEN);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

app.listen(PORT, () => logger.info(`gateway listening on :${PORT}, forwarding to ${WEBHOOK_URL}`));

startSocket().catch(err => {
  logger.error({ err: err.message }, "socket_start_failed");
  process.exit(1);
});
