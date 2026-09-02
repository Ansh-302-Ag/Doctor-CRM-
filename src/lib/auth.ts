import { sql } from "./db";
import { verifyPassword } from "./password";
import type { Role } from "./rbac";

export type Credentials = { email: string; password: string };

/**
 * Verify a staff login. Returns null for both "no such account" and "wrong
 * password", and always does the scrypt work, so the response does not reveal
 * which accounts exist.
 */
export async function authenticate(c: Credentials) {
  const [row] = await sql<{
    id: string; clinic_id: string; name: string; role: Role; password_hash: string;
  }[]>`select id, clinic_id, name, role, password_hash
         from staff_users where lower(email) = lower(${c.email})`;

  const hash = row?.password_hash ??
    "scrypt:00000000000000000000000000000000:" + "0".repeat(128);
  const ok = await verifyPassword(c.password, hash);

  if (!ok || !row) return null;
  return { id: row.id, clinicId: row.clinic_id, name: row.name, role: row.role };
}
