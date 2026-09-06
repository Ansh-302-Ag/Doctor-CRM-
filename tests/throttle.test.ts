import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, reset, seed, closeAll } from "./helpers";
import {
  assertNotThrottled, recordFailure, clearFailures, TooManyAttempts, MAX_ATTEMPTS,
} from "../src/lib/throttle";
import { authenticate } from "../src/lib/auth";

beforeEach(async () => { await reset(); await seed(); await db`delete from login_attempts`; });
after(closeAll);

test("a few failures are allowed", async () => {
  for (let i = 0; i < MAX_ATTEMPTS - 1; i++) await recordFailure(db, "desk@test.clinic");
  await assertNotThrottled(db, "desk@test.clinic");
});

test("too many failures lock the account out, with a retry hint", async () => {
  for (let i = 0; i < MAX_ATTEMPTS; i++) await recordFailure(db, "desk@test.clinic");
  await assert.rejects(assertNotThrottled(db, "desk@test.clinic"), (e: TooManyAttempts) => {
    assert.equal(e.name, "TooManyAttempts");
    assert.ok(e.retryAfterSeconds > 0);
    return true;
  });
});

test("the lockout is per email, not global", async () => {
  for (let i = 0; i < MAX_ATTEMPTS; i++) await recordFailure(db, "desk@test.clinic");
  await assertNotThrottled(db, "rao@test.clinic");
});

test("email casing cannot be used to sidestep the lockout", async () => {
  for (let i = 0; i < MAX_ATTEMPTS; i++) await recordFailure(db, "desk@test.clinic");
  await assert.rejects(assertNotThrottled(db, "DESK@Test.Clinic"), TooManyAttempts);
});

test("old failures fall outside the window", async () => {
  for (let i = 0; i < MAX_ATTEMPTS; i++) await recordFailure(db, "desk@test.clinic");
  await db`update login_attempts set attempted_at = now() - interval '1 hour'`;
  await assertNotThrottled(db, "desk@test.clinic");
});

test("a successful login clears the count", async () => {
  for (let i = 0; i < MAX_ATTEMPTS - 1; i++) await recordFailure(db, "desk@test.clinic");
  await clearFailures(db, "desk@test.clinic");
  for (let i = 0; i < MAX_ATTEMPTS - 1; i++) await recordFailure(db, "desk@test.clinic");
  await assertNotThrottled(db, "desk@test.clinic");
});

test("authenticate records a failure and clears it on success", async () => {
  await authenticate({ email: "desk@test.clinic", password: "wrong" }, db);
  assert.equal((await db`select 1 from login_attempts`).length, 1);

  await authenticate({ email: "desk@test.clinic", password: "correct horse" }, db);
  assert.equal((await db`select 1 from login_attempts`).length, 0);
});

test("authenticate refuses once locked out, even with the right password", async () => {
  for (let i = 0; i < MAX_ATTEMPTS; i++) await recordFailure(db, "desk@test.clinic");
  await assert.rejects(
    authenticate({ email: "desk@test.clinic", password: "correct horse" }, db),
    TooManyAttempts,
  );
});
