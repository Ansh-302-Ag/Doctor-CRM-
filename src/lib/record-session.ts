/**
 * The patient's short-lived "I entered the code" cookie for /r/<token>.
 * Separate from the staff cookie: a different name, scoped to /r, and it
 * proves only that this browser verified THIS link in the last VIEW_MINUTES.
 */
import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { VIEW_MINUTES } from "./record-links";

type RecordView = { linkId?: string; until?: number };

const options = (): SessionOptions => ({
  password: process.env.SESSION_SECRET ?? "",
  cookieName: "record_view",
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/r",
    maxAge: VIEW_MINUTES * 60,
  },
});

async function session() {
  const o = options();
  if (typeof o.password !== "string" || o.password.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters");
  }
  return getIronSession<RecordView>(await cookies(), o);
}

/** The link this browser verified, if still in time. */
export async function viewedLinkId(): Promise<string | null> {
  const s = await session();
  return s.linkId && typeof s.until === "number" && s.until > Date.now() ? s.linkId : null;
}

/** Call from a server action only (cookies can be set there, not in render). */
export async function markVerified(linkId: string) {
  const s = await session();
  s.linkId = linkId;
  s.until = Date.now() + VIEW_MINUTES * 60_000;
  await s.save();
}
