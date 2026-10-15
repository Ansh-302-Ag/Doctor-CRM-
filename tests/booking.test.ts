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

test("bookAppointment reports whether a reminder was scheduled", async () => {
  const far = await bookAppointment(db, AGENT, "agent",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(10, 3) });
  assert.equal(far.reminderScheduled, true);

  // Booked two hours before the visit: the reminder's send time is already past.
  const at = futureSlot(11, 3);
  const near = await bookAppointment(db, AGENT, "agent",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: at },
    new Date(at.getTime() - 2 * 3_600_000));
  assert.equal(near.reminderScheduled, false);
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

test("cancel and reschedule refuse an appointment that is not booked", async () => {
  const appt = await bookAppointment(db, AGENT, "agent",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(15) });
  await cancelAppointment(db, AGENT, "agent", { appointmentId: appt.id, patientId: f.patientId });

  await assert.rejects(
    cancelAppointment(db, AGENT, "agent", { appointmentId: appt.id, patientId: f.patientId }),
    (e: BookingError) => e.code === "not_active",
  );
  await assert.rejects(
    rescheduleAppointment(db, AGENT, "agent", {
      appointmentId: appt.id, patientId: f.patientId, startsAt: futureSlot(16),
    }),
    (e: BookingError) => e.code === "not_active",
  );
});

test("a patient cannot be booked with another clinic's doctor", async () => {
  await assert.rejects(
    bookAppointment(db, AGENT, "agent",
      { patientId: f.patientId, doctorId: f.otherDoctorId, startsAt: futureSlot(10) }),
    (e: BookingError) => e.code === "wrong_clinic",
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

test("simultaneous moves and cancels of one appointment leave at most one booked visit", async () => {
  const appt = await bookAppointment(db, AGENT, "agent",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(10) });
  const input = { appointmentId: appt.id, patientId: f.patientId };
  const results = await Promise.allSettled([
    rescheduleAppointment(db, AGENT, "agent", { ...input, startsAt: futureSlot(12) }),
    rescheduleAppointment(db, AGENT, "agent", { ...input, startsAt: futureSlot(14) }),
    cancelAppointment(db, AGENT, "agent", input),
  ]);
  // Whichever wins, the losers are refused as not_active and nothing is doubled.
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  for (const r of results) {
    if (r.status === "rejected") assert.equal((r.reason as BookingError).code, "not_active");
  }
  const booked = await db`select 1 from appointments where status = 'booked'`;
  assert.ok(booked.length <= 1, `${booked.length} booked visits`);
  // A reschedule that loses and cancels its own new booking leaves an audit trail too.
  const cancelled = await db<{ id: string }[]>`select id from appointments where status = 'cancelled'`;
  for (const { id } of cancelled) {
    const rows = await db`select 1 from audit_log where action = 'cancel_appointment' and target_id = ${id}`;
    assert.equal(rows.length, 1, `cancelled appointment ${id} has no audit row`);
  }
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

/**
 * The calendar (src/app/(crm)/page.tsx) picks a day with a half-open range on the
 * raw starts_at column instead of `(starts_at at time zone tz)::date = day`, so
 * that the index on appointments (clinic_id, starts_at) can actually be used.
 * The two forms must agree — including on the days that are not 24 hours long.
 */
test("the calendar's day range matches the local date, across DST", async () => {
  const tz = "America/New_York";
  const at = async (iso: string) => {
    const [row] = await db<{ id: string }[]>`
      insert into appointments (clinic_id, doctor_id, patient_id, starts_at, ends_at, created_by)
      values (${f.clinicId}, ${f.doctorId}, ${f.patientId}, ${iso}::timestamptz,
              ${iso}::timestamptz + interval '30 minutes', 'agent')
      returning id`;
    return row.id;
  };

  // The half-open range the page uses.
  const range = async (day: string) => [...await db<{ id: string }[]>`
    select id from appointments
     where clinic_id = ${f.clinicId}
       and starts_at >= (${day} || ' 00:00')::timestamp at time zone ${tz}
       and starts_at <  ((${day} || ' 00:00')::timestamp + interval '1 day')
                        at time zone ${tz}
     order by starts_at`].map(r => r.id);

  // The form it replaced, kept here only as the oracle to compare against.
  const byDate = async (day: string) => [...await db<{ id: string }[]>`
    select id from appointments
     where clinic_id = ${f.clinicId}
       and (starts_at at time zone ${tz})::date = ${day}::date
     order by starts_at`].map(r => r.id);

  const cases = [
    // Spring forward: 2026-03-08 is 23 hours long in New York (EST → EDT).
    { day: "2026-03-08",
      inside:  ["2026-03-08T05:30:00Z", "2026-03-09T03:30:00Z"],   // 00:30 EST, 23:30 EDT
      outside: ["2026-03-08T04:30:00Z", "2026-03-09T04:30:00Z"] }, // 23:30 the 7th, 00:30 the 9th
    // Fall back: 2026-11-01 is 25 hours long (EDT → EST).
    { day: "2026-11-01",
      inside:  ["2026-11-01T04:30:00Z", "2026-11-02T04:30:00Z"],   // 00:30 EDT, 23:30 EST
      outside: ["2026-11-01T03:30:00Z", "2026-11-02T05:30:00Z"] }, // 23:30 Oct 31, 00:30 Nov 2
  ];

  for (const c of cases) {
    const expected = [];
    for (const iso of c.inside) expected.push(await at(iso));
    for (const iso of c.outside) await at(iso);

    assert.deepEqual(await range(c.day), expected, `${c.day}: wrong rows`);
    assert.deepEqual(await range(c.day), await byDate(c.day), `${c.day}: disagrees with the date cast`);
  }
});

test("the first slot is 09:00 at the clinic whatever zone the server runs in", async () => {
  // The bug: a `timestamp` parameter was parsed in the host's zone, so on an
  // IST laptop every slot came out 5h30m early and none could be booked.
  const prev = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const day = localDay(futureSlot(10));
    const [first] = await checkAvailability(db, f.doctorId, day);
    assert.equal(first.startsAt.toISOString(), `${day}T03:30:00.000Z`);   // 09:00 IST
  } finally {
    if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
  }
});
