/**
 * What happens to each message in a webhook delivery (docs/08).
 *
 * Kept out of the route so it can be driven with fake senders against the test
 * database. Deliberately does not import ../db, which connects at import time.
 */
import type { Pool } from "./db";
import { handleInbound, type Reply } from "./agent";
import type { Classifier } from "./agent/intent";
import { templates } from "./agent/screen";
import { parseInbound } from "./webhook";
import { mask, type Outbound, type StaffAlert } from "./channel";

export type Senders = {
  sendMessage(m: Outbound): Promise<{ delivered: boolean }>;
  notifyStaff(a: StaffAlert): Promise<void>;
};

export async function processWebhook(
  pool: Pool, payload: unknown, clinicId: string, senders: Senders, classify?: Classifier,
): Promise<{ received: number }> {
  const { texts, unsupported, failed, unidentified } = parseInbound(payload);

  // Only a page needs the name, so most deliveries never look it up. A failed
  // lookup must not stop the page itself: the id is uglier but still a page.
  let clinicName: Promise<string> | undefined;
  const page = async (urgent: boolean, note: string) => {
    clinicName ??= pool<{ name: string }[]>`select name from clinics where id = ${clinicId}`
      .then(([c]) => c?.name ?? clinicId)
      .catch(e => { console.error("[webhook] clinic name lookup failed", e); return clinicId; });
    await senders.notifyStaff({ clinicName: await clinicName, urgent, note });
  };

  for (const m of [...texts, ...unsupported]) {
    let reply: Reply | null;
    try {
      reply = await handleInbound(pool, { clinicId, body: "", ...m }, new Date(), classify);
    } catch (e) {
      // Nothing was answered, so telling the patient there was a problem is true.
      console.error("[webhook] inbound handling failed", e);
      await senders.sendMessage({ to: m.phone, text: templates.technicalFailure() }).catch(() => {});
      await page(false, `Could not process a message from ${mask(m.phone)}. Check the server logs.`);
      continue;
    }
    if (!reply) continue;                                       // duplicate delivery

    // Page first: if the reply then fails to send, staff already know.
    if (reply.escalated) {
      await page(!!reply.urgent,
        `${reply.urgent ? "URGENT: " : ""}Escalation from ${mask(m.phone)}. Open the escalation inbox.`);
    }
    try {
      await senders.sendMessage({ to: m.phone, text: reply.text });
    } catch (e) {
      // The work is done (a booking may exist), so a "technical issue" message
      // would be a lie. Staff tell the patient instead.
      console.error("[webhook] reply send failed", e);
      await page(!!reply.urgent,
        `Reply to ${mask(m.phone)} could not be delivered. Contact the patient directly.`);
    }
  }

  for (const s of failed) {
    console.error("[whatsapp] delivery failed", mask(s.recipient), s.code, s.title);
  }
  if (unidentified > 0) {
    console.error(`[webhook] ${unidentified} message(s) without a usable sender`);
    await page(false,
      "A WhatsApp user without a visible phone number messaged the clinic and could not be answered.");
  }

  return { received: texts.length + unsupported.length };
}
