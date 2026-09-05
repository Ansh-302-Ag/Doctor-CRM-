import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { purgeDeletedPatients } from "@/lib/consent";
import { requireCronSecret } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Destroys records whose retention window has passed (docs/02). Run daily.
export async function GET(req: Request) {
  const denied = requireCronSecret(req);
  if (denied) return denied;
  return NextResponse.json(await purgeDeletedPatients(sql));
}
