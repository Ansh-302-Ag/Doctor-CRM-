import { NextResponse } from "next/server";
import { agentSql } from "@/lib/db";
import { verifySignature } from "@/lib/webhook";
import { sendMessage, notifyStaff } from "@/lib/channel";
import { processWebhook } from "@/lib/inbound";

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

  let payload: unknown;
  try { payload = JSON.parse(raw); }
  catch { return new Response("invalid JSON", { status: 400 }); }

  // Always 200 to Meta once the payload is understood — a non-200 makes Meta
  // redeliver, and redelivery is handled by dedupe, not by retrying failures here.
  return NextResponse.json(
    await processWebhook(agentSql, payload, clinicId, { sendMessage, notifyStaff }));
}
