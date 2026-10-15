import { timingSafeEqual } from "node:crypto";

/**
 * Guards the scheduler-driven endpoints.
 *
 * Anyone who can call these can make the clinic message its patients or destroy
 * records, so a missing secret is a hard failure rather than an open door.
 * Returns null when the caller is authorised, or the Response to return when not.
 */
export function requireCronSecret(req: Request, envName = "CRON_SECRET"): Response | null {
  const secret = process.env[envName];
  if (!secret) {
    return Response.json({ error: `${envName} is not configured` }, { status: 500 });
  }
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response("unauthorized", { status: 401 });
  }
  return null;
}
