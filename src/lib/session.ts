import { cache } from "react";
import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";
import { redirect } from "next/navigation";
import { sql } from "./db";
import type { Role } from "./rbac";

export type SessionUser = { id: string; clinicId: string; name: string; role: Role };
type SessionData = { user?: SessionUser };

const options: SessionOptions = {
  password: process.env.SESSION_SECRET ?? "",
  cookieName: "clinic_crm",
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 8,          // a shift, not a month — this is patient data
  },
};

export async function getSession() {
  if (typeof options.password !== "string" || options.password.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters");
  }
  return getIronSession<SessionData>(await cookies(), options);
}

/** Use at the top of every CRM page. Redirects to the login screen when signed out. */
export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  if (!session.user) redirect("/login");
  return session.user;
}

export async function signIn(user: SessionUser) {
  const session = await getSession();
  session.user = user;
  await session.save();
}

export async function signOut() {
  const session = await getSession();
  session.destroy();
}

/** Look up the staff account behind a session, so a deleted or changed account
 *  cannot keep acting on a stale cookie.
 *
 *  `cache()` dedupes this within a single request — the layout and the page it
 *  wraps both call this, and without memoizing it that was a second staff_users
 *  round trip on every navigation.
 *
 *  The clinic is joined in rather than fetched separately: the timezone is
 *  needed to render any date on any page, and the database is a continent away,
 *  so a second query for one column cost a full round trip on every page load. */
export const currentStaff = cache(async () => {
  const user = await requireUser();
  const [row] = await sql<{
    id: string; clinic_id: string; name: string; role: Role;
    doctor_id: string | null; timezone: string;
  }[]>`
    select u.id, u.clinic_id, u.name, u.role, u.doctor_id, c.timezone
      from staff_users u
      join clinics c on c.id = u.clinic_id
     where u.id = ${user.id}`;
  if (!row) redirect("/login");
  return {
    id: row.id, clinicId: row.clinic_id, name: row.name, role: row.role,
    // Set exactly when the role is 'doctor' (the staff_users check constraint).
    // Without it the prescription form had to ask which doctor was prescribing,
    // which let a doctor attribute his own prescription to a colleague.
    doctorId: row.doctor_id,
    timezone: row.timezone,
  };
});

