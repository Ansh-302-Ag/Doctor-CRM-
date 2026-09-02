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

export async function sendMessage(msg: Outbound): Promise<{ delivered: boolean }> {
  if (!configured()) {
    console.log(`[channel:simulated] → ${msg.to}\n${msg.text}`);
    return { delivered: false };
  }
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
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

/** Tell the on-duty staff number that something needs a human (docs/03). */
export async function notifyStaff(text: string) {
  const to = process.env.STAFF_NOTIFY_PHONE;
  if (!to) { console.log(`[staff-notify] ${text}`); return; }
  await sendMessage({ to, text }).catch(e => console.error("staff notify failed", e));
}
