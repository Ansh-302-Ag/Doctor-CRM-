import { TEMPLATES, type TemplateName } from "./templates";

/**
 * Outbound messaging. Talks to the WhatsApp Cloud API when it is configured,
 * and otherwise records the message and returns — which is what lets the whole
 * loop be exercised locally (scripts/sim.ts) with no Meta account.
 *
 * Swapping in real credentials is an env change, not a code change.
 */
export type Outbound = { to: string; text: string };

const configured = () =>
  Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

/** Graph API versions expire roughly two years after release; v26.0 was
 *  released 2026-07-29. Bump this when Meta announces its end of life. */
const API_BASE = "https://graph.facebook.com/v26.0";

export async function sendMessage(msg: Outbound): Promise<{ delivered: boolean }> {
  if (!configured()) {
    // The body is health-adjacent and the number identifies the patient
    // (docs/02); logs are the easiest place for both to leak. `npm run sim`
    // prints the conversation itself, so nothing is lost here.
    console.log(`[channel:simulated] → ${mask(msg.to)} (${msg.text.length} chars)`);
    return { delivered: false };
  }
  const res = await fetch(
    `${API_BASE}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: msg.to,
        type: "text",
        text: { body: msg.text },
      }),
    },
  );
  if (!res.ok) throw new Error(`whatsapp send failed: ${res.status} ${await res.text()}`);
  return { delivered: true };
}

/** Keep the last two digits, so a log line can be tied to a conversation
 *  by someone who already has the record, and to nobody else. */
export const mask = (phone: string) => `${"*".repeat(Math.max(0, phone.length - 2))}${phone.slice(-2)}`;

/**
 * Tell the on-duty staff number that something needs a human (docs/03).
 *
 * Without STAFF_NOTIFY_PHONE an escalation reaches the CRM inbox but pings
 * nobody, so an emergency waits until someone happens to look. That is a
 * deployment gap worth shouting about, not a quiet default.
 */
export async function notifyStaff(text: string) {
  const to = process.env.STAFF_NOTIFY_PHONE;
  if (!to) {
    console.warn("[staff-notify] STAFF_NOTIFY_PHONE is not set — escalation " +
                 "is visible in the CRM inbox only, and nobody has been paged.");
    return;
  }
  await sendMessage({ to, text }).catch(e => console.error("staff notify failed", e));
}

/**
 * Send a pre-approved template. This is the ONLY way to message a patient
 * outside the 24-hour window WhatsApp allows after their last message, so every
 * reminder goes through here — never through sendMessage.
 */
export async function sendTemplate(msg: {
  to: string; name: TemplateName; parameters: string[];
}): Promise<{ delivered: boolean }> {
  const spec = TEMPLATES[msg.name];
  if (msg.parameters.length !== spec.params.length) {
    throw new Error(
      `template '${msg.name}' needs ${spec.params.length} parameters, got ${msg.parameters.length}`);
  }
  if (!configured()) {
    console.log(`[channel:simulated template] -> ${mask(msg.to)} (${msg.name})`);
    return { delivered: false };
  }

  const res = await fetch(
    `${API_BASE}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: msg.to,
        type: "template",
        template: {
          name: msg.name,
          language: { code: spec.language },
          components: [{
            type: "body",
            parameters: msg.parameters.map(text => ({ type: "text", text })),
          }],
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`whatsapp template send failed: ${res.status} ${await res.text()}`);
  return { delivered: true };
}
