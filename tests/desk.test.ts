import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, agentDb, reset, seed, futureSlot, closeAll, type Fixture } from "./helpers";
import { bookAppointment } from "../src/lib/booking";
import { registerPatient, markArrived, setOutcome } from "../src/lib/desk";
import { can } from "../src/lib/rbac";

let f: Fixture;
let desk: { kind: "staff"; id: string };

before(async () => { await reset(); });
beforeEach(async () => {
  await reset(); f = await seed();
  desk = { kind: "staff", id: f.receptionistId };
});
after(closeAll);

const book = (startsAt = futureSlot(10)) =>
  bookAppointment(db, desk, "receptionist",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt });

/** An appointment already under way — inserted directly, since booking refuses the past. */
async function pastAppointment() {
  const [a] = await db<{ id: string }[]>`
    insert into appointments (clinic_id, doctor_id, patient_id, starts_at, ends_at, created_by)
    values (${f.clinicId}, ${f.doctorId}, ${f.patientId},
            now() - interval '10 minutes', now() + interval '20 minutes', 'test')
    returning id`;
  return a.id;
}

test("registers a walk-in with desk consent and an audit row", async () => {
  const r = await registerPatient(db, desk, "receptionist", f.clinicId,
    { name: "Divya", phone: "98765 43210", consent: true });
  assert.equal(r.existing, false);

  const [p] = await db`select name, phone, consent_status from patients where id = ${r.id}`;
  assert.deepEqual({ ...p }, { name: "Divya", phone: "+919876543210", consent_status: "granted" });
  const [c] = await db`select channel from consent_log where patient_id = ${r.id}`;
  assert.equal(c.channel, "desk");
  const [a] = await db`select actor from audit_log
                        where action = 'register_patient' and target_id = ${r.id}`;
  assert.equal(a.actor, f.receptionistId);
});

test("a known phone in another format opens the existing record untouched", async () => {
  const r = await registerPatient(db, desk, "receptionist", f.clinicId,
    { name: "Someone Else", phone: "090000 00001", consent: true });
  assert.deepEqual(r, { id: f.patientId, existing: true });
  const [p] = await db`select name from patients where id = ${f.patientId}`;
  assert.equal(p.name, "Asha");
});

test("registration refuses missing consent, a blank name and a bad phone", async () => {
  await assert.rejects(registerPatient(db, desk, "receptionist", f.clinicId,
    { name: "Divya", phone: "9876543210", consent: false }), /consent required/);
  await assert.rejects(registerPatient(db, desk, "receptionist", f.clinicId,
    { name: "  ", phone: "9876543210", consent: true }), /name required/);
  await assert.rejects(registerPatient(db, desk, "receptionist", f.clinicId,
    { name: "Divya", phone: "123", consent: true }), /invalid phone number/);
  const [{ n }] = await db`select count(*)::int as n from patients where phone = '+919876543210'`;
  assert.equal(n, 0);
});

test("markArrived stamps arrived_at and leaves the appointment booked", async () => {
  const appt = await book();
  await markArrived(db, desk, "receptionist", f.clinicId, appt.id);
  const [a] = await db`select status, arrived_at from appointments where id = ${appt.id}`;
  assert.equal(a.status, "booked");
  assert.ok(a.arrived_at instanceof Date);
});

test("markArrived refuses a cancelled appointment and another clinic's", async () => {
  const appt = await book();
  await assert.rejects(markArrived(db, desk, "receptionist", f.otherClinicId, appt.id), /not_active/);
  await db`update appointments set status = 'cancelled' where id = ${appt.id}`;
  await assert.rejects(markArrived(db, desk, "receptionist", f.clinicId, appt.id), /not_active/);
});

test("setOutcome completed sets the status and cancels the scheduled reminder", async () => {
  const appt = await book(futureSlot(10, 3));
  assert.equal(appt.reminderScheduled, true);
  await setOutcome(db, desk, "receptionist", f.clinicId, appt.id, "completed");

  const [a] = await db`select status from appointments where id = ${appt.id}`;
  assert.equal(a.status, "completed");
  const [r] = await db`select status from reminders where related_id = ${appt.id}`;
  assert.equal(r.status, "cancelled");
  // Only from booked: a second outcome is refused.
  await assert.rejects(
    setOutcome(db, desk, "receptionist", f.clinicId, appt.id, "no_show"), /not_active/);
});

test("no_show waits until the appointment has started", async () => {
  const appt = await book();
  await assert.rejects(
    setOutcome(db, desk, "receptionist", f.clinicId, appt.id, "no_show"), /not started yet/);

  const started = await pastAppointment();
  await setOutcome(db, desk, "receptionist", f.clinicId, started, "no_show");
  const [a] = await db`select status from appointments where id = ${started}`;
  assert.equal(a.status, "no_show");
});

test("a doctor may set outcomes only on his own appointments", async () => {
  const appt = await book();
  const doc = { kind: "staff", id: f.doctorUserId } as const;
  await assert.rejects(
    setOutcome(db, doc, "doctor", f.clinicId, appt.id, "completed", crypto.randomUUID()),
    /not your appointment/);
  await setOutcome(db, doc, "doctor", f.clinicId, appt.id, "completed", f.doctorId);
  const [a] = await db`select status from appointments where id = ${appt.id}`;
  assert.equal(a.status, "completed");
});

test("a doctor may mark arrived only on his own appointments", async () => {
  const appt = await book();
  const doc = { kind: "staff", id: f.doctorUserId } as const;
  await assert.rejects(
    markArrived(db, doc, "doctor", f.clinicId, appt.id, crypto.randomUUID()),
    /not your appointment/);
  await markArrived(db, doc, "doctor", f.clinicId, appt.id, f.doctorId);
  const [a] = await db`select arrived_at from appointments where id = ${appt.id}`;
  assert.ok(a.arrived_at instanceof Date);
});

test("a staff booking is recorded as made by that staff member", async () => {
  const appt = await book();
  const [a] = await db`select created_by from appointments where id = ${appt.id}`;
  assert.equal(a.created_by, f.receptionistId);
});

test("desk consent revives a soft-deleted or unconsented known number", async () => {
  await db`update patients set consent_status = 'withdrawn', deleted_at = now()
            where id = ${f.patientId}`;
  // Without consent the deleted record cannot be opened.
  await assert.rejects(registerPatient(db, desk, "receptionist", f.clinicId,
    { name: "Asha", phone: "9000000001", consent: false }), /consent required/);

  const r = await registerPatient(db, desk, "receptionist", f.clinicId,
    { name: "Asha", phone: "9000000001", consent: true });
  assert.deepEqual(r, { id: f.patientId, existing: true });
  const [p] = await db`select consent_status, deleted_at from patients where id = ${f.patientId}`;
  assert.deepEqual({ ...p }, { consent_status: "granted", deleted_at: null });

  await db`update patients set consent_status = 'pending' where id = ${f.otherPatientId}`;
  await registerPatient(db, desk, "receptionist", f.clinicId,
    { name: "Bilal", phone: "9000000002", consent: true });
  const [o] = await db`select consent_status from patients where id = ${f.otherPatientId}`;
  assert.equal(o.consent_status, "granted");
  const [{ n }] = await db`select count(*)::int as n from consent_log where channel = 'desk'`;
  assert.equal(n, 2);
});

test("the agent role has none of the desk permissions", () => {
  for (const p of ["patients:write", "patients:merge", "tasks:write"] as const) {
    assert.equal(can("agent", p), false, p);
  }
  assert.equal(can("doctor", "patients:merge"), false);
  assert.equal(can("receptionist", "patients:merge"), true);
  assert.equal(can("doctor", "tasks:write"), true);
});

test("the agent database role cannot read patient_notes or tasks", async () => {
  const denied = (e: { code?: string }) => e.code === "42501";
  await assert.rejects(agentDb`select * from patient_notes`, denied);
  await assert.rejects(agentDb`select * from tasks`, denied);
});

test("a doctor registering a number outside his scope is refused and nothing is written", async () => {
  await db`update patients set consent_status = 'pending' where id = ${f.patientId}`;
  const doctor = { kind: "staff" as const, id: f.doctorUserId };
  await assert.rejects(registerPatient(db, doctor, "doctor", f.clinicId,
    { name: "Asha", phone: "9000000001", consent: true }, f.doctorId), /patient not found/);
  assert.equal((await db`select 1 from consent_log where patient_id = ${f.patientId}`).length, 0);
  assert.equal((await db`select 1 from audit_log`).length, 0);
  const [p] = await db`select consent_status from patients where id = ${f.patientId}`;
  assert.equal(p.consent_status, "pending");
});

test("a doctor registering his own patient's number works as before", async () => {
  await book();
  const doctor = { kind: "staff" as const, id: f.doctorUserId };
  const r = await registerPatient(db, doctor, "doctor", f.clinicId,
    { name: "Asha", phone: "9000000001", consent: false }, f.doctorId);
  assert.deepEqual(r, { id: f.patientId, existing: true });
});
