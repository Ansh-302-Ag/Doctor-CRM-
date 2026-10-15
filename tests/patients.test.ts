import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, reset, seed, closeAll, futureSlot, type Fixture } from "./helpers";
import { searchPatients, getPatient, setPatientName, RECALL_AFTER_DAYS } from "../src/lib/patients";
import { createPrescription } from "../src/lib/prescriptions";
import { bookAppointment } from "../src/lib/booking";

let f: Fixture;
const STAFF = () => ({ kind: "staff" as const, id: f.receptionistId });

beforeEach(async () => { await reset(); f = await seed(); });
after(closeAll);

test("search finds a patient by name or by phone", async () => {
  const byName = await searchPatients(db, STAFF(), "receptionist", f.clinicId, "asha");
  assert.equal(byName.length, 1);
  assert.equal(byName[0].id, f.patientId);

  const byPhone = await searchPatients(db, STAFF(), "receptionist", f.clinicId, "9000000002");
  assert.equal(byPhone.length, 1);
  assert.equal(byPhone[0].id, f.otherPatientId);
});

test("search finds a patient by a phone typed in any format", async () => {
  for (const q of ["+91 90000-00001", "090000 00001", "9000000001", "00001"]) {
    const r = await searchPatients(db, STAFF(), "receptionist", f.clinicId, q);
    assert.deepEqual(r.map(x => x.id), [f.patientId], q);
  }
});

test("a partial phone typed with a 0 or +91 prefix still finds the patient", async () => {
  for (const q of ["0900000", "+91 900000", "91900000"]) {
    const r = await searchPatients(db, STAFF(), "receptionist", f.clinicId, q);
    assert.ok(r.some(x => x.id === f.patientId), q);
  }
});

test("fewer than 4 digits never match by phone digits", async () => {
  // "0-0-0" is inside both numbers by digits only (plain ilike cannot see it),
  // and three digits is not a phone search yet; "0-0-0-0" is.
  assert.equal((await searchPatients(db, STAFF(), "receptionist", f.clinicId, "0-0-0")).length, 0);
  assert.equal((await searchPatients(db, STAFF(), "receptionist", f.clinicId, "0-0-0-0")).length, 2);
});

test("a doctor's phone-digit search excludes patients outside his scope", async () => {
  await bookAppointment(db, STAFF(), "receptionist",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(10) });
  const doc = { kind: "staff" as const, id: f.doctorUserId };
  const mine = await searchPatients(db, doc, "doctor", f.clinicId, "9000000001", f.doctorId);
  assert.deepEqual(mine.map(x => x.id), [f.patientId]);
  assert.equal((await searchPatients(db, doc, "doctor", f.clinicId, "9000000002", f.doctorId)).length, 0);
});

test("an empty query lists the clinic's patients", async () => {
  assert.equal((await searchPatients(db, STAFF(), "receptionist", f.clinicId, "")).length, 2);
});

test("search never returns another clinic's patients", async () => {
  assert.equal((await searchPatients(db, STAFF(), "receptionist", f.clinicId, "chetan")).length, 0);
  assert.equal(await getPatient(db, STAFF(), "receptionist", f.clinicId, f.otherClinicPatientId), null);
});

test("search excludes patients who asked to be deleted", async () => {
  await db`update patients set deleted_at = now() where id = ${f.patientId}`;
  assert.equal((await searchPatients(db, STAFF(), "receptionist", f.clinicId, "asha")).length, 0);
});

test("the summary carries the next appointment and active prescription count", async () => {
  await bookAppointment(db, STAFF(), "receptionist",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(10) });
  await createPrescription(db, { kind: "staff", id: f.doctorUserId }, "doctor", {
    patientId: f.patientId, doctorId: f.doctorId,
    drugName: "Amoxicillin", dosage: "500mg twice daily",
  });

  const p = await getPatient(db, STAFF(), "receptionist", f.clinicId, f.patientId);
  assert.ok(p);
  assert.ok(p.next_appointment);
  assert.strictEqual(p.active_prescriptions, 1);
});

test("a name can be captured and is trimmed", async () => {
  await setPatientName(db, { kind: "agent" }, f.otherPatientId, "  Bilal Ahmed  ");
  const [row] = await db<{ name: string }[]>`select name from patients where id = ${f.otherPatientId}`;
  assert.equal(row.name, "Bilal Ahmed");
});

test("a blank name never overwrites a real one", async () => {
  await setPatientName(db, { kind: "agent" }, f.patientId, "   ");
  const [row] = await db<{ name: string }[]>`select name from patients where id = ${f.patientId}`;
  assert.equal(row.name, "Asha");
});

test("reading a patient record writes an audit row", async () => {
  await getPatient(db, STAFF(), "receptionist", f.clinicId, f.patientId);
  const rows = await db<{ action: string }[]>`
    select action from audit_log where target_id = ${f.patientId}`;
  assert.ok([...rows].some(r => r.action === "read_patient"));
});

// Saved lists. Appointments go in directly so past and agent-made ones are easy.
const DAY = 86_400_000;
async function appt(patientId: string, at: Date, status = "booked", createdBy = "agent", doctorId = f.doctorId) {
  await db`insert into appointments (clinic_id, doctor_id, patient_id, starts_at, ends_at, status, created_by)
           values (${f.clinicId}, ${doctorId}, ${patientId}, ${at}, ${new Date(at.getTime() + 1_800_000)},
                   ${status}::appointment_status, ${createdBy})`;
}
const list = async (name: string, q = "") =>
  (await searchPatients(db, STAFF(), "receptionist", f.clinicId, q, null, name)).map(x => x.id);

test("consent-pending lists only patients whose consent is pending", async () => {
  await db`update patients set consent_status = 'pending' where id = ${f.patientId}`;
  assert.deepEqual(await list("consent-pending"), [f.patientId]);
});

test("upcoming lists only patients with a booked visit still ahead", async () => {
  await appt(f.patientId, futureSlot(10));
  await appt(f.otherPatientId, new Date(Date.now() - 2 * DAY));          // booked, but past
  await appt(f.otherPatientId, futureSlot(11), "cancelled", f.receptionistId);
  assert.deepEqual(await list("upcoming"), [f.patientId]);
});

test("recall lists patients seen long ago with nothing since or ahead", async () => {
  const old = new Date(Date.now() - (RECALL_AFTER_DAYS + 20) * DAY);
  await appt(f.patientId, old, "completed");
  await appt(f.otherPatientId, old, "completed");
  await appt(f.otherPatientId, futureSlot(10));                            // already coming back
  assert.deepEqual(await list("recall"), [f.patientId]);

  // A recent visit of any kind, even a no-show, takes him off the list; and a
  // patient never actually seen is not a recall.
  await appt(f.patientId, new Date(Date.now() - 10 * DAY), "no_show");
  assert.deepEqual(await list("recall"), []);
  await db`delete from appointments`;
  await appt(f.patientId, old, "cancelled");
  assert.deepEqual(await list("recall"), []);
});

test("on-medication lists only patients with an active prescription", async () => {
  for (const [patientId, status] of [[f.patientId, "active"], [f.otherPatientId, "completed"]]) {
    await db`insert into prescriptions (patient_id, doctor_id, drug_name, dosage, status, created_by)
             values (${patientId}, ${f.doctorId}, 'Amoxicillin', '500mg', ${status}::prescription_status, ${f.doctorUserId})`;
  }
  assert.deepEqual(await list("on-medication"), [f.patientId]);
});

test("ai-booked lists only patients the assistant has booked", async () => {
  await appt(f.patientId, futureSlot(10), "booked", "agent");
  await appt(f.otherPatientId, futureSlot(11), "booked", f.receptionistId);
  assert.deepEqual(await list("ai-booked"), [f.patientId]);
});

test("a list combines with the search text", async () => {
  await appt(f.patientId, futureSlot(10));
  await appt(f.otherPatientId, futureSlot(11));
  assert.deepEqual(await list("upcoming", "bilal"), [f.otherPatientId]);
  assert.deepEqual(await list("upcoming", "9000000001"), [f.patientId]);
  assert.deepEqual(await list("consent-pending", "asha"), []);
});

test("a list never widens a doctor's scope", async () => {
  const [d2] = await db<{ id: string }[]>`
    insert into doctors (clinic_id, name, specialty, default_slot_minutes)
    values (${f.clinicId}, 'Dr Second', 'ENT', 30) returning id`;
  await appt(f.patientId, futureSlot(10));
  await appt(f.otherPatientId, futureSlot(10), "booked", "agent", d2.id);
  const mine = await searchPatients(db, { kind: "staff", id: f.doctorUserId }, "doctor",
    f.clinicId, "", f.doctorId, "upcoming");
  assert.deepEqual(mine.map(x => x.id), [f.patientId]);
});

test("an unknown list name is ignored", async () => {
  assert.equal((await list("nope")).length, 2);
  assert.equal((await list("")).length, 2);
});
