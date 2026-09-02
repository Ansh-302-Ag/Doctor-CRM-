import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  db, reset, seed, futureSlot, localDay, closeAll, type Fixture,
} from "./helpers";
import {
  checkAvailability, bookAppointment, rescheduleAppointment, cancelAppointment,
  getUpcomingAppointments, BookingError,
} from "../src/lib/booking";
import { ConsentRequired } from "../src/lib/consent";
import { Forbidden } from "../src/lib/rbac";

const AGENT = { kind: "agent" } as const;
let f: Fixture;

before(async () => { await reset(); });
beforeEach(async () => { await reset(); f = await seed(); });
after(closeAll);

test("books a slot and records who booked it", async () => {
  const at = futureSlot(10);
  const appt = await bookAppointment(db, AGENT, "agent",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: at, reasonText: "fever" });

  assert.equal(appt.startsAt.getTime(), at.getTime());
  assert.equal(appt.endsAt.getTime() - appt.startsAt.getTime(), 30 * 60_000);

  const [row] = await db`select created_by, reason_text, status from appointments where id = ${appt.id}`;
  assert.equal(row.created_by, "agent");
  assert.equal(row.reason_text, "fever");
  assert.equal(row.status, "booked");
});

test("a booked slot disappears from availability", async () => {
  const at = futureSlot(10);
  const before = await checkAvailability(db, f.doctorId, localDay(at));
  await bookAppointment(db, AGENT, "agent",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: at });
  const after = await checkAvailability(db, f.doctorId, localDay(at));

  assert.equal(after.length, before.length - 1);
  assert.ok(!after.some(s => s.startsAt.getTime() === at.getTime()));
});

test("double-booking the same slot is rejected", async () => {
  const at = futureSlot(11);
  await bookAppointment(db, AGENT, "agent",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: at });

  await assert.rejects(
    bookAppointment(db, AGENT, "agent",
      { patientId: f.otherPatientId, doctorId: f.doctorId, startsAt: at }),
    (e: BookingError) => e.code === "slot_taken",
  );
});

test("concurrent bookings of the same slot: exactly one wins", async () => {
  const at = futureSlot(12);
  const attempt = (patientId: string) =>
    bookAppointment(db, AGENT, "agent", { patientId, doctorId: f.doctorId, startsAt: at })
      .then(() => "ok" as const, (e: BookingError) => e.code);

  // Ten simultaneous attempts on one slot. The exclusion constraint, not application
  // check-then-write, is what makes this safe (docs/08).
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      attempt(i % 2 === 0 ? f.patientId : f.otherPatientId)),
  );

  assert.equal(results.filter(r => r === "ok").length, 1);
  assert.ok(results.filter(r => r !== "ok").every(r => r === "slot_taken"), `got ${results}`);

  const rows = await db`select id from appointments where status = 'booked'`;
  assert.equal(rows.length, 1);
});

test("overlapping (not identical) slots are also rejected", async () => {
  const at = futureSlot(13);                                   // 30-minute slot
  await bookAppointment(db, AGENT, "agent",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: at });

  await assert.rejects(
    bookAppointment(db, AGENT, "agent", {
      patientId: f.otherPatientId, doctorId: f.doctorId,
      startsAt: new Date(at.getTime() + 15 * 60_000),          // overlaps by 15 minutes
    }),
    (e: BookingError) => e.code === "slot_taken",
  );
});

test("a cancelled appointment frees its slot", async () => {
  const at = futureSlot(14);
  const appt = await bookAppointment(db, AGENT, "agent",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: at });
  await cancelAppointment(db, AGENT, "agent",
    { appointmentId: appt.id, patientId: f.patientId });

  const again = await bookAppointment(db, AGENT, "agent",
    { patientId: f.otherPatientId, doctorId: f.doctorId, startsAt: at });
  assert.ok(again.id);
});

test("booking without consent is refused", async () => {
  await reset();
  const g = await seed({ consent: "pending" });
  await assert.rejects(
    bookAppointment(db, AGENT, "agent",
      { patientId: g.patientId, doctorId: g.doctorId, startsAt: futureSlot(10) }),
    ConsentRequired,
  );
  const rows = await db`select id from appointments`;
  assert.equal(rows.length, 0);
});

test("past slots and closed hours are refused", async () => {
  await assert.rejects(
    bookAppointment(db, AGENT, "agent", {
      patientId: f.patientId, doctorId: f.doctorId,
      startsAt: new Date(Date.now() - 3_600_000),
    }),
    (e: BookingError) => e.code === "slot_in_past",
  );
  await assert.rejects(
    bookAppointment(db, AGENT, "agent",
      { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(22) }),
    (e: BookingError) => e.code === "outside_hours",
  );
});

test("a patient cannot cancel or reschedule someone else's appointment", async () => {
  const appt = await bookAppointment(db, AGENT, "agent",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(15) });

  await assert.rejects(
    cancelAppointment(db, AGENT, "agent",
      { appointmentId: appt.id, patientId: f.otherPatientId }),
    (e: BookingError) => e.code === "not_your_appointment",
  );
  await assert.rejects(
    rescheduleAppointment(db, AGENT, "agent", {
      appointmentId: appt.id, patientId: f.otherPatientId, startsAt: futureSlot(16),
    }),
    (e: BookingError) => e.code === "not_your_appointment",
  );
});

test("rescheduling moves the appointment and leaves one booked row", async () => {
  const from = futureSlot(10), to = futureSlot(16);
  const appt = await bookAppointment(db, AGENT, "agent",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: from });
  const moved = await rescheduleAppointment(db, AGENT, "agent",
    { appointmentId: appt.id, patientId: f.patientId, startsAt: to });

  assert.equal(moved.startsAt.getTime(), to.getTime());
  const booked = await db`select starts_at from appointments where status = 'booked'`;
  assert.equal(booked.length, 1);
  const [old] = await db`select status from appointments where id = ${appt.id}`;
  assert.equal(old.status, "rescheduled");
});

test("rescheduling into a taken slot keeps the original appointment", async () => {
  const mine = futureSlot(10), theirs = futureSlot(11);
  const appt = await bookAppointment(db, AGENT, "agent",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: mine });
  await bookAppointment(db, AGENT, "agent",
    { patientId: f.otherPatientId, doctorId: f.doctorId, startsAt: theirs });

  await assert.rejects(
    db.begin(tx => rescheduleAppointment(tx, AGENT, "agent",
      { appointmentId: appt.id, patientId: f.patientId, startsAt: theirs })),
    (e: BookingError) => e.code === "slot_taken",
  );

  const [still] = await db`select status from appointments where id = ${appt.id}`;
  assert.equal(still.status, "booked", "a failed reschedule must not lose the appointment");
});

test("upcoming appointments exclude cancelled and past ones", async () => {
  const appt = await bookAppointment(db, AGENT, "agent",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(10) });
  await bookAppointment(db, AGENT, "agent",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(11) });
  await cancelAppointment(db, AGENT, "agent",
    { appointmentId: appt.id, patientId: f.patientId });

  const upcoming = await getUpcomingAppointments(db, AGENT, "agent", f.patientId);
  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0].doctor_name, "Dr. Rao");
});

test("availability is empty on a day the clinic is closed", async () => {
  const sunday = new Date("2026-09-06T04:00:00+05:30");   // a Sunday in IST
  assert.deepEqual([...await checkAvailability(db, f.doctorId, localDay(sunday))], []);
});

test("every booking writes an audit row", async () => {
  const appt = await bookAppointment(db, AGENT, "agent",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(10) });
  const rows = await db<{ actor: string; action: string }[]>`
    select actor, action from audit_log where target_id = ${appt.id}`;
  assert.deepEqual([...rows], [{ actor: "agent", action: "book_appointment" }]);
});

test("a role without appointments:write cannot book", async () => {
  await assert.rejects(
    // @ts-expect-error — deliberately passing a role outside the matrix' write set
    bookAppointment(db, AGENT, "nobody",
      { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(10) }),
  );
  assert.throws(() => {
    const { requirePermission } = require("../src/lib/rbac");
    requirePermission("agent", "prescriptions:write");
  }, Forbidden);
});
