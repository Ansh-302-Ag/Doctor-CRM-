/**
 * Parsing and verifying WhatsApp Cloud API webhooks.
 * Kept apart from the route handler so it can be tested without a server.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Meta signs the raw body with the app secret; we compare in constant time.
 *
 * With no secret configured this returns false. Accepting unsigned payloads
 * lets anyone POST a message claiming any phone number — booking, cancelling,
 * or triggering delete-my-data on a stranger's record — so skipping the check
 * is an explicit opt-in (ALLOW_UNSIGNED_WEBHOOKS=1), never inferred from
 * NODE_ENV happening not to say "production".
 */
export function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return process.env.ALLOW_UNSIGNED_WEBHOOKS === "1";
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// The envelope is checked loosely; each message and status is validated on its
// own so one malformed entry (e.g. a username user with no `from`) cannot
// discard its neighbours.
const envelope = z.object({
  entry: z.array(z.object({
    changes: z.array(z.object({
      value: z.object({
        messages: z.array(z.unknown()).optional(),
        statuses: z.array(z.unknown()).optional(),
      }),
    })),
  })),
});

const message = z.object({
  from: z.string().min(1),
  id: z.string(),
  type: z.string(),
  text: z.object({ body: z.string() }).optional(),
  unsupported: z.object({ type: z.string().optional() }).optional(),
}).loose();

const status = z.object({
  id: z.string(),
  status: z.string(),
  recipient_id: z.string().optional(),
  errors: z.array(z.object({ code: z.number().optional(), title: z.string().optional() })).optional(),
});

export type InboundText = { phone: string; body: string; providerMessageId: string };
export type InboundOther = { phone: string; providerMessageId: string; kind: string };
export type FailedStatus = { messageId: string; recipient: string; code: number | null; title: string };

const CAPTIONED = ["image", "video", "document"];
// Nothing to answer: no reply, no page.
const IGNORED = ["reaction", "system"];

/** Text and captioned media become texts. Everything else with no tool is
 *  surfaced as unsupported so it escalates rather than vanishing. Messages we
 *  cannot attribute to a phone are only counted. */
export function parseInbound(body: unknown): {
  texts: InboundText[]; unsupported: InboundOther[]; failed: FailedStatus[]; unidentified: number;
} {
  const texts: InboundText[] = [];
  const unsupported: InboundOther[] = [];
  const failed: FailedStatus[] = [];
  let unidentified = 0;

  const parsed = envelope.safeParse(body);
  if (!parsed.success) return { texts, unsupported, failed, unidentified };

  for (const entry of parsed.data.entry)
    for (const change of entry.changes) {
      for (const raw of change.value.messages ?? []) {
        const m = message.safeParse(raw);
        if (!m.success) { unidentified++; continue; }
        const { from, id, type } = m.data;
        if (IGNORED.includes(type)) continue;
        const phone = `+${from.replace(/^\+/, "")}`;
        const caption = CAPTIONED.includes(type)
          ? (m.data[type] as { caption?: unknown } | undefined)?.caption : undefined;
        if (type === "text" && m.data.text) {
          texts.push({ phone, body: m.data.text.body, providerMessageId: id });
        } else if (typeof caption === "string" && caption.trim()) {
          texts.push({ phone, body: caption, providerMessageId: id });
        } else {
          const kind = type === "unsupported" ? (m.data.unsupported?.type ?? "unsupported") : type;
          unsupported.push({ phone, providerMessageId: id, kind });
        }
      }
      for (const raw of change.value.statuses ?? []) {
        const st = status.safeParse(raw);
        if (!st.success || st.data.status !== "failed") continue;
        const err = st.data.errors?.[0];
        failed.push({
          messageId: st.data.id, recipient: st.data.recipient_id ?? "",
          code: err?.code ?? null, title: err?.title ?? "",
        });
      }
    }
  return { texts, unsupported, failed, unidentified };
}
