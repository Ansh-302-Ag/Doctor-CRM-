/**
 * Login throttling.
 *
 * Keyed on the submitted email rather than the IP: a clinic's staff all share
 * one connection, so an IP lock takes the whole front desk offline while barely
 * inconveniencing an attacker on a phone network.
 */
import type { Db } from "./db";

export const MAX_ATTEMPTS = 8;
export const WINDOW_MINUTES = 15;

export class TooManyAttempts extends Error {
  constructor(public retryAfterSeconds: number) {
    super("too many sign-in attempts; try again shortly");
    this.name = "TooManyAttempts";
  }
}

export async function assertNotThrottled(db: Db, email: string): Promise<void> {
  const [row] = await db<{ attempts: string; oldest: Date | null }[]>`
    select count(*) as attempts, min(attempted_at) as oldest
      from login_attempts
     where lower(email) = lower(${email})
       and attempted_at > now() - (${WINDOW_MINUTES} * interval '1 minute')`;

  if (Number(row.attempts) < MAX_ATTEMPTS) return;
  const unlocksAt = new Date(row.oldest!.getTime() + WINDOW_MINUTES * 60_000);
  throw new TooManyAttempts(
    Math.max(1, Math.ceil((unlocksAt.getTime() - Date.now()) / 1000)));
}

export async function recordFailure(db: Db, email: string): Promise<void> {
  await db`insert into login_attempts (email) values (${email})`;
  // Opportunistic cleanup — this table is transient and nothing reads history.
  await db`delete from login_attempts
            where attempted_at < now() - (${WINDOW_MINUTES} * interval '1 minute') * 4`;
}

export async function clearFailures(db: Db, email: string): Promise<void> {
  await db`delete from login_attempts where lower(email) = lower(${email})`;
}
