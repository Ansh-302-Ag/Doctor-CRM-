/**
 * Staff login. This is the layer between the public internet and a medical
 * record, and it previously had no tests at all — a code review demonstrated
 * that replacing verifyPassword with `return true` left the whole suite green.
 */
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, reset, seed, closeAll } from "./helpers";
import { hashPassword, verifyPassword } from "../src/lib/password";
import { authenticate } from "../src/lib/auth";

beforeEach(async () => { await reset(); await seed(); });
after(closeAll);

test("a correct password verifies and a wrong one does not", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  assert.equal(await verifyPassword("correct horse battery stapl", hash), false);
  assert.equal(await verifyPassword("", hash), false);
  assert.equal(await verifyPassword("CORRECT HORSE BATTERY STAPLE", hash), false);
});

test("the same password hashes differently every time", async () => {
  const [a, b] = await Promise.all([hashPassword("hunter2"), hashPassword("hunter2")]);
  assert.notEqual(a, b, "a missing salt would make these identical");
  assert.equal(await verifyPassword("hunter2", a), true);
  assert.equal(await verifyPassword("hunter2", b), true);
});

test("the hash records its own cost, so it can be raised later", async () => {
  const [scheme, N, r, p, salt, key] = (await hashPassword("x")).split(":");
  assert.equal(scheme, "scrypt");
  assert.ok(Number(N) >= 1 << 17, `N=${N} is below the OWASP floor`);
  assert.ok(Number(r) > 0 && Number(p) > 0);
  assert.equal(salt.length, 32);
  assert.equal(key.length, 128);
});

test("a malformed or truncated stored hash is rejected, not thrown on", async () => {
  for (const bad of [
    "", "scrypt", "scrypt:x", "notscrypt:1:8:1:aa:bb",
    "scrypt:0:8:1:aa:bb", "scrypt:131072:8:1:zz:bb",
    "scrypt:131072:8:1:aa",
    "$2b$10$abcdefghijklmnopqrstuv",
  ]) assert.equal(await verifyPassword("anything", bad), false, bad);
});

test("authenticate accepts the right password and rejects everything else", async () => {
  const ok = await authenticate({ email: "desk@test.clinic", password: "correct horse" }, db);
  assert.ok(ok, "the seeded receptionist should be able to sign in");
  assert.equal(ok.role, "receptionist");
  assert.ok(ok.clinicId);

  assert.equal(await authenticate({ email: "desk@test.clinic", password: "wrong" }, db), null);
  assert.equal(await authenticate({ email: "nobody@test.clinic", password: "correct horse" }, db), null);
  assert.equal(await authenticate({ email: "", password: "" }, db), null);
});

test("email matching is case-insensitive, as the login form implies", async () => {
  const ok = await authenticate({ email: "DESK@Test.Clinic", password: "correct horse" }, db);
  assert.ok(ok, "a capitalised email must reach the same account");
});

test("an unknown email costs the same work as a known one", async () => {
  const time = async (email: string) => {
    const t = process.hrtime.bigint();
    await authenticate({ email, password: "some password" }, db);
    return Number(process.hrtime.bigint() - t) / 1e6;
  };
  await time("warmup@test.clinic");

  const known = await time("desk@test.clinic");
  const unknown = await time("nobody@test.clinic");
  const ratio = Math.max(known, unknown) / Math.max(1, Math.min(known, unknown));
  // A missing dummy-hash path shows up as the unknown email returning instantly.
  assert.ok(ratio < 5, `known ${known.toFixed(0)}ms vs unknown ${unknown.toFixed(0)}ms`);
});

test("the database refuses two accounts differing only by capitalisation", async () => {
  const [clinic] = await db<{ id: string }[]>`select id from clinics limit 1`;
  await assert.rejects(
    db`insert into staff_users (clinic_id, name, email, password_hash, role)
       values (${clinic.id}, 'Impostor', 'DESK@test.clinic',
               ${await hashPassword("x")}, 'receptionist')`,
    (e: { code?: string }) => e.code === "23505",
  );
});
