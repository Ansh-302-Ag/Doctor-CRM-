import { NextResponse } from "next/server";
import { agentSql } from "@/lib/db";
import { handleInbound } from "@/lib/agent";
import { verifySignature, parseInbound } from "@/lib/webhook";
import { sendMessage, notifyStaff, mask } from "@/lib/channel";
import { templates } from "@/lib/agent/screen";

export const runtime = "nodejs";

/** Meta's subscription handshake. */
export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  if (q.get("hub.mode") === "subscribe" &&
      q.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(q.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    return new Response("bad signature", { status: 401 });
  }

  const clinicId = process.env.CLINIC_ID;
  if (!clinicId) return new Response("CLINIC_ID not configured", { status: 500 });

  const { texts, unsupported } = parseInbound(JSON.parse(raw));
  const [{ name: clinicName }] = await agentSql<{ name: string }[]>`
    select name from clinics where id = ${clinicId}`;

  // Always 200 to Meta once the payload is understood — a non-200 makes Meta
  // redeliver, and redelivery is handled by dedupe, not by retrying failures here.
  for (const m of texts) {
    try {
      const reply = await handleInbound(agentSql, { clinicId, ...m });
      if (!reply) continue;                                   // duplicate delivery
      await sendMessage({ to: m.phone, text: reply.text });
      if (reply.escalated) await notifyStaff({
        clinicName, urgent: false,
        note: `Escalation from ${mask(m.phone)}. Open the escalation inbox.`,
      });
    } catch (e) {
      // docs/08: never drop the message silently. Tell the patient, tell staff.
      console.error("inbound handling failed", e);
      await sendMessage({ to: m.phone, text: templates.technicalFailure() }).catch(() => {});
      await notifyStaff({
        clinicName, urgent: false,
        note: `Could not process a message from ${mask(m.phone)}. Check the server logs.`,
      });
    }
  }

  for (const m of unsupported) {
    await sendMessage({
      to: m.phone,
      text: "I can only read text messages. Someone from the clinic team will follow up.",
    }).catch(() => {});
    await notifyStaff({
      clinicName, urgent: false, note: `Unsupported message from ${mask(m.phone)}.`,
    });
  }

  return NextResponse.json({ received: texts.length + unsupported.length });
}
