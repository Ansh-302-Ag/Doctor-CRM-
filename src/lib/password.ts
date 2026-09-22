import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** OWASP's floor for scrypt. The cost is stored in the hash, so changing it
 *  re-hashes new passwords without invalidating existing ones — which is also
 *  what lets the test suite turn it down.
 *
 *  At the production cost one hash takes ~285 ms, and the suite hashes twice
 *  per fixture in ~180 tests: about 100 seconds spent proving node's scrypt
 *  still works. Tests set SCRYPT_COST low and keep one case at the real cost.
 *  A weak cost in production is a silent, serious downgrade, so it is refused
 *  rather than warned about. */
const MIN_PRODUCTION_COST = 17;

function cost(): number {
  const raw = process.env.SCRYPT_COST;
  if (raw === undefined) return MIN_PRODUCTION_COST;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 22) {
    throw new Error(`SCRYPT_COST must be an integer between 1 and 22, got ${raw}`);
  }
  if (n < MIN_PRODUCTION_COST && process.env.NODE_ENV === "production") {
    throw new Error(
      `SCRYPT_COST=${n} is below the production floor of ${MIN_PRODUCTION_COST}. ` +
      `Passwords hashed at that cost are materially easier to crack.`);
  }
  return n;
}

const r = 8, p = 1;
const KEY_LENGTH = 64;   // node's default maxmem is too small for N=2^17, so derive() sets it

const derive = (password: string, salt: Buffer, params: { N: number; r: number; p: number }) =>
  scryptAsync(password, salt, KEY_LENGTH, { ...params, maxmem: 256 * params.N * params.r });

export async function hashPassword(password: string): Promise<string> {
  const N = 1 << cost();
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r, p });
  return `scrypt:${N}:${r}:${p}:${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts[0] !== "scrypt" || parts.length !== 6) return false;
  const [, sN, sr, sp, saltHex, keyHex] = parts;
  const params = { N: Number(sN), r: Number(sr), p: Number(sp) };
  if (!Object.values(params).every(v => Number.isInteger(v) && v > 0)) return false;
  if (!/^[0-9a-f]+$/.test(saltHex) || !/^[0-9a-f]+$/.test(keyHex)) return false;

  const key = await derive(password, Buffer.from(saltHex, "hex"), params);
  const expected = Buffer.from(keyHex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}
