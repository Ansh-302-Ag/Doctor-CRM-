import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, reset, seed, closeAll, futureSlot, type Fixture } from "./helpers";
import {
  scheduleAppointmentReminder, scheduleRefillFollowup, runDueReminders, claimDue, MAX_ATTEMPTS,
} from "../src/lib/reminders";
import { bookAppointment, cancelAppointment } from "../src/lib/booking";
import { createPrescription, discontinuePrescription } from "../src/lib/prescriptions";

let f: Fixture;
const STAFF = () => ({ kind: "staff" as const, id: f.receptionistId });
const DOCTOR = () => ({ kind: "staff" as const, id: f.doctorUserId });

beforeEach(async () => { await reset(); f = await seed(); });
after(closeAll);

/** A send that records what it was asked to deliver instead of calling Meta. */
const recorder = () => {
  const sent: { to: string; name: string; parameters: string[] }[] = [];
  return { sent, send: async (m: typeof sent[number]) => { sent.push(m); return { delivered: true }; } };
};
const due = () => db`update reminders set send_at = now() - interval '1 minute'
                      where status = 'scheduled'`;

test("booking an appointment schedules a reminder for the day before", async () => {
  const at = futureSlot(10, 5);
  const appt = await bookAppointment(db, STAFF(), "receptionist",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: at });

  const [r] = await db<{ type: string; send_at: Date; status: string; related_id: string }[]>`
    select type, send_at, status, related_id from reminders`;
  assert.equal(r.type, "appointment");
  assert.equal(r.status, "scheduled");
  assert.equal(r.related_id, appt.id);
  assert.equal(Math.round((at.getTime() - r.send_at.getTime()) / 3_600_000), 24);
});

test("cancelling an appointment cancels its reminder", async () => {
  const appt = await bookAppointment(db, STAFF(), "receptionist",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(10, 5) });
  await cancelAppointment(db, STAFF(), "receptionist",
    { appointmentId: appt.id, patientId: f.patientId });

  const [r] = await db<{ status: string }[]>`select status from reminders`;
  assert.equal(r.status, "cancelled");
});

test("scheduling twice for one appointment leaves a single reminder", async () => {
  const at = futureSlot(10, 5);
  const appt = await bookAppointment(db, STAFF(), "receptionist",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: at });
  await scheduleAppointmentReminder(db, appt.id, f.patientId, at);

  assert.equal((await db`select id from reminders where status = 'scheduled'`).length, 1,
    "a redelivered booking must not double the reminder");
});

test("only reminders that are due are claimed", async () => {
  await bookAppointment(db, STAFF(), "receptionist",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(10, 5) });
  assert.equal((await claimDue(db)).length, 0, "not due yet");

  await due();
  const rows = await claimDue(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].phone, "+919000000001");
  assert.equal(rows[0].doctor_name, "Dr. Rao");
});

test("a due appointment reminder is sent as a template, once", async () => {
  await bookAppointment(db, STAFF(), "receptionist",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(10, 5) });
  await due();

  const rec = recorder();
  assert.deepEqual(await runDueReminders(db, { send: rec.send as never }),
    { sent: 1, skipped: 0, failed: 0 });
  assert.equal(rec.sent[0].name, "appointment_reminder");
  assert.equal(rec.sent[0].to, "+919000000001");
  assert.ok(rec.sent[0].parameters.includes("Dr. Rao"));

  assert.deepEqual(await runDueReminders(db, { send: rec.send as never }),
    { sent: 0, skipped: 0, failed: 0 }, "a sent reminder is not resent");
  assert.equal(rec.sent.length, 1);
});

test("a reminder for a cancelled appointment is not sent", async () => {
  const appt = await bookAppointment(db, STAFF(), "receptionist",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(10, 5) });
  await due();
  // Cancel directly, bypassing cancelAppointment, so the send-time check is what
  // has to catch it rather than the cancellation path.
  await db`update appointments set status = 'cancelled' where id = ${appt.id}`;

  const rec = recorder();
  assert.deepEqual(await runDueReminders(db, { send: rec.send as never }),
    { sent: 0, skipped: 1, failed: 0 });
  assert.equal(rec.sent.length, 0);
});

test("a reminder for a discontinued prescription is not sent", async () => {
  // docs/08 testing bar: state is re-checked at send time, not schedule time.
  const { id } = await createPrescription(db, DOCTOR(), "doctor", {
    patientId: f.patientId, doctorId: f.doctorId,
    drugName: "Amoxicillin", dosage: "500mg twice daily", durationDays: 5,
  });
  await scheduleRefillFollowup(db, id, f.patientId, new Date(Date.now() - 60_000));
  await discontinuePrescription(db, DOCTOR(), "doctor", id);

  const rec = recorder();
  assert.deepEqual(await runDueReminders(db, { send: rec.send as never }),
    { sent: 0, skipped: 1, failed: 0 });
  assert.equal(rec.sent.length, 0, "a discontinued drug must never be reminded about");

  const [r] = await db<{ status: string }[]>`select status from reminders`;
  assert.equal(r.status, "cancelled");
});

test("a reminder for a withdrawn patient is not sent", async () => {
  await bookAppointment(db, STAFF(), "receptionist",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(10, 5) });
  await due();
  await db`update patients set consent_status = 'withdrawn', deleted_at = now()
            where id = ${f.patientId}`;

  const rec = recorder();
  assert.equal((await runDueReminders(db, { send: rec.send as never })).sent, 0);
  assert.equal(rec.sent.length, 0);
});

test("a failing send is retried, then surfaced to staff", async () => {
  await bookAppointment(db, STAFF(), "receptionist",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(10, 5) });
  await due();

  const boom = async () => { throw new Error("network down"); };
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await runDueReminders(db, { send: boom as never });
    await due();
  }

  const [r] = await db<{ status: string; attempts: number; last_error: string }[]>`
    select status, attempts, last_error from reminders`;
  assert.equal(r.status, "failed");
  assert.equal(r.attempts, MAX_ATTEMPTS);
  assert.match(r.last_error, /network down/);

  // docs/08: a silently-failed reminder is a real harm, so it must escalate.
  const rows = await db<{ reason: string }[]>`select reason from escalations`;
  assert.ok([...rows].some(e => /reminder/i.test(e.reason)),
    "staff must be told a reminder could not be delivered");
});
