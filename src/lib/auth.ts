import { sql, type Db } from "./db";
import { hashPassword, verifyPassword } from "./password";
import type { Role } from "./rbac";
import { assertNotThrottled, recordFailure, clearFailures } from "./throttle";

/** Built once, on first use, from a value nobody can log in with. */
let dummyHash: Promise<string> | null = null;
const getDummyHash = () =>
  (dummyHash ??= hashPassword(`no-such-account:${Math.random()}:${Date.now()}`));

export type Credentials = { email: string; password: string };

/**
 * Verify a staff login. Returns null for both "no such account" and "wrong
 * password", and always does the scrypt work, so the response does not reveal
 * which accounts exist.
 */
export async function authenticate(c: Credentials, db: Db = sql) {
  await assertNotThrottled(db, c.email);

  const [row] = await db<{
    id: string; clinic_id: string; name: string; role: Role; password_hash: string;
  }[]>`select id, clinic_id, name, role, password_hash
         from staff_users where lower(email) = lower(${c.email})`;

  // A well-formed hash of nothing, so an unknown email costs the same scrypt
  // work as a known one. Its shape must track hashPassword's, or the early
  // return in verifyPassword makes unknown emails measurably faster.
  const hash = row?.password_hash ?? (await getDummyHash());
  const ok = await verifyPassword(c.password, hash);

  if (!ok || !row) {
    await recordFailure(db, c.email);
    return null;
  }
  await clearFailures(db, c.email);
  return { id: row.id, clinicId: row.clinic_id, name: row.name, role: row.role };
}
