import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** OWASP's floor for scrypt. The cost is stored in the hash, so raising it
 *  later re-hashes new passwords without invalidating existing ones. */
const N = 1 << 17, r = 8, p = 1;
const KEY_LENGTH = 64;
const maxmem = 256 * N * r;      // node's default cap is too small for N=2^17

const derive = (password: string, salt: Buffer, params: { N: number; r: number; p: number }) =>
  scryptAsync(password, salt, KEY_LENGTH, { ...params, maxmem: 256 * params.N * params.r });

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEY_LENGTH, { N, r, p, maxmem });
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
