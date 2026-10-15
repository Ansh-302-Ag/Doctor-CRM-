import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, reset, seed, closeAll, futureSlot, type Fixture } from "./helpers";
import { searchPatients, getPatient, setPatientName } from "../src/lib/patients";
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
