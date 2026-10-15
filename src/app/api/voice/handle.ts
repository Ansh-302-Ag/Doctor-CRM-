import { NextResponse } from "next/server";
import { agentSql } from "@/lib/db";
import { requireCronSecret } from "@/lib/cron-auth";
import { VoiceInputError } from "@/lib/voice";
import { BookingError } from "@/lib/booking";

/**
 * Shared shell for the voice agent's endpoints: bearer VOICE_API_SECRET, JSON in,
 * JSON out, runs as the restricted agent role. Bad input comes back as 200 with
 * `error` so the voice agent can read it out and ask again rather than go silent.
 */
export async function handleVoice(
  req: Request,
  fn: (db: typeof agentSql, clinicId: string, body: Record<string, unknown>) => Promise<unknown>,
) {
  const denied = requireCronSecret(req, "VOICE_API_SECRET");
  if (denied) return denied;
  const clinicId = process.env.CLINIC_ID;
  if (!clinicId) return new Response("CLINIC_ID not configured", { status: 500 });

  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    try { body = await req.json(); }
    catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  }

  try {
    return NextResponse.json(await fn(agentSql, clinicId, body));
  } catch (e) {
    if (e instanceof VoiceInputError || e instanceof BookingError) {
      return NextResponse.json({ error: e.message, message: `ERROR, nothing was done: ${e.message}` });
    }
    console.error("[voice]", e);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

export const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
