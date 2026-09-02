/**
 * Parsing and verifying WhatsApp Cloud API webhooks.
 * Kept apart from the route handler so it can be tested without a server.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** Meta signs the raw body with the app secret; we compare in constant time. */
export function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";   // unsigned local dev only
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const payload = z.object({
  entry: z.array(z.object({
    changes: z.array(z.object({
      value: z.object({
        messages: z.array(z.object({
          from: z.string(),
          id: z.string(),
          type: z.string(),
          text: z.object({ body: z.string() }).optional(),
        })).optional(),
      }),
    })),
  })),
});

export type InboundText = { phone: string; body: string; providerMessageId: string };

/** Text messages only. Anything else (image, audio, location) has no tool and
 *  is surfaced to the caller as unsupported so it escalates rather than vanishing. */
export function parseInbound(body: unknown): {
  texts: InboundText[]; unsupported: { phone: string; providerMessageId: string }[];
} {
  const parsed = payload.safeParse(body);
  if (!parsed.success) return { texts: [], unsupported: [] };

  const texts: InboundText[] = [];
  const unsupported: { phone: string; providerMessageId: string }[] = [];
  for (const entry of parsed.data.entry)
    for (const change of entry.changes)
      for (const m of change.value.messages ?? []) {
        if (m.type === "text" && m.text) {
          texts.push({ phone: `+${m.from.replace(/^\+/, "")}`, body: m.text.body, providerMessageId: m.id });
        } else {
          unsupported.push({ phone: `+${m.from.replace(/^\+/, "")}`, providerMessageId: m.id });
        }
      }
  return { texts, unsupported };
}
