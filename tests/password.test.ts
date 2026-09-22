/**
 * The suite runs with SCRYPT_COST low so it is not spending ~100 seconds
 * proving node's scrypt works. These tests cover what that knob must never
 * break: the real production cost, and that a hash carries its own cost so
 * changing the setting cannot lock anyone out.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/lib/password";

const atCost = async <T>(value: string | undefined, fn: () => Promise<T>): Promise<T> => {
  const before = process.env.SCRYPT_COST;
  if (value === undefined) delete process.env.SCRYPT_COST; else process.env.SCRYPT_COST = value;
  try { return await fn(); } finally {
    if (before === undefined) delete process.env.SCRYPT_COST; else process.env.SCRYPT_COST = before;
  }
};

test("the production cost is what an unconfigured deployment gets", async () => {
  const hash = await atCost(undefined, () => hashPassword("correct horse"));
  assert.match(hash, /^scrypt:131072:8:1:/, "an unset SCRYPT_COST must mean N = 2^17");
  assert.equal(await verifyPassword("correct horse", hash), true);
  assert.equal(await verifyPassword("wrong horse", hash), false);
});

test("a hash carries its own cost, so changing the setting locks nobody out", async () => {
  // The scenario this guards: raise (or lower) the cost, and yesterday's
  // passwords must still verify — the parameters come from the stored hash,
  // never from the current environment.
  const old = await atCost("12", () => hashPassword("correct horse"));
  assert.match(old, /^scrypt:4096:8:1:/);
  const verified = await atCost(undefined, () => verifyPassword("correct horse", old));
  assert.equal(verified, true, "a hash made at another cost must still verify");
});

test("a nonsensical cost fails loudly rather than hashing weakly", async () => {
  for (const bad of ["0", "-1", "23", "seventeen", ""]) {
    await assert.rejects(() => atCost(bad, () => hashPassword("x")), /SCRYPT_COST/,
      `SCRYPT_COST=${JSON.stringify(bad)} should be refused`);
  }
});

test("production refuses a cost below the floor", async () => {
  const env = process.env.NODE_ENV;
  // `process.env` rejects defineProperty; plain assignment is the only way in.
  (process.env as Record<string, string | undefined>).NODE_ENV = "production";
  try {
    await assert.rejects(() => atCost("12", () => hashPassword("x")), /production floor/);
    // The floor itself is still allowed.
    assert.match(await atCost("17", () => hashPassword("x")), /^scrypt:131072:/);
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = env;
  }
});

test("a malformed stored hash is rejected, never treated as a match", async () => {
  for (const stored of ["", "scrypt:abc", "notscrypt:4096:8:1:aa:bb", "scrypt:0:8:1:aa:bb"]) {
    assert.equal(await verifyPassword("correct horse", stored), false, stored);
  }
});
