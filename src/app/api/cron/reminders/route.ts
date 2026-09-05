import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { runDueReminders } from "@/lib/reminders";
import { requireCronSecret } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sends every reminder that has come due. The app is serverless, so nothing
 * runs on a timer inside it — point a scheduler at this every 15 minutes
 * (Vercel Cron, GitHub Actions, cron-job.org) with the shared secret.
 *
 * Anyone who can call this can make the clinic message its patients, so it
 * refuses to run without a configured secret rather than defaulting to open.
 */
export async function GET(req: Request) {
  const denied = requireCronSecret(req);
  if (denied) return denied;
  return NextResponse.json(await runDueReminders(sql));
}
