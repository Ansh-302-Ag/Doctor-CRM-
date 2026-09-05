/**
 * The booking path under real concurrent load. Not a benchmark — a correctness
 * test at a scale the unit tests do not reach (docs/07 Phase 3).
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { db, reset, seed, closeAll, futureSlot, localDay } from "./helpers";
import { bookAppointment, checkAvailability, type BookingError } from "../src/lib/booking";

let f: Awaited<ReturnType<typeof seed>>;
before(async () => { await reset(); f = await seed(); });
after(closeAll);

test("100 concurrent bookings across 8 slots produce exactly 8 appointments", async () => {
  const day = localDay(futureSlot(10, 4));
  const slots = (await checkAvailability(db, f.doctorId, day)).slice(0, 8);
  assert.ok(slots.length >= 8, `need at least 8 free slots, got ${slots.length}`);

  const staff = { kind: "staff" as const, id: f.receptionistId };
  const results = await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      bookAppointment(db, staff, "receptionist", {
        patientId: i % 2 === 0 ? f.patientId : f.otherPatientId,
        doctorId: f.doctorId,
        startsAt: slots[i % slots.length].startsAt,
      }).then(() => "ok" as const, (e: BookingError) => e.code)));

  const won = results.filter(r => r === "ok").length;
  const lost = results.filter(r => r === "slot_taken").length;
  assert.equal(won, 8, "one winner per slot, no more");
  assert.equal(won + lost, 100, `unexpected codes: ${[...new Set(results)].join(",")}`);

  const booked = await db<{ starts_at: Date }[]>`
    select starts_at from appointments where status = 'booked' and doctor_id = ${f.doctorId}`;
  assert.equal(booked.length, 8);

  // And no two of them overlap, which is the property that actually matters.
  const times = [...booked].map(b => b.starts_at.getTime());
  assert.equal(new Set(times).size, times.length);
});

test("availability never grows while bookings are landing", async () => {
  const day = localDay(futureSlot(10, 6));
  const staff = { kind: "staff" as const, id: f.receptionistId };
  const before_ = await checkAvailability(db, f.doctorId, day);

  const bookings = before_.slice(0, 5).map(s =>
    bookAppointment(db, staff, "receptionist",
      { patientId: f.patientId, doctorId: f.doctorId, startsAt: s.startsAt })
      .catch(() => null));
  const reads = Array.from({ length: 20 }, () => checkAvailability(db, f.doctorId, day));

  const [, ...views] = await Promise.all([Promise.all(bookings), ...reads]);
  for (const view of views) assert.ok(view.length <= before_.length);

  assert.equal((await checkAvailability(db, f.doctorId, day)).length, before_.length - 5);
});
