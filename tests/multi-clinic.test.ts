/**
 * One clinic must not read or change another's data through any path.
 * Every test uses clinic A's staff against clinic B's ids.
 */
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, reset, seed, closeAll, futureSlot, type Fixture } from "./helpers";
import { searchPatients, getPatient } from "../src/lib/patients";
import { createPrescription, discontinuePrescription, listPrescriptions } from "../src/lib/prescriptions";
import {
  listEscalations, acknowledgeEscalation, resolveEscalation, NotFound,
} from "../src/lib/escalations";
import { bookAppointment } from "../src/lib/booking";

let f: Fixture;
const A = () => ({ kind: "staff" as const, id: f.receptionistId });

beforeEach(async () => { await reset(); f = await seed(); });
after(closeAll);

async function escalationAtOtherClinic() {
  const [e] = await db<{ id: string }[]>`
    insert into escalations (conversation_id, patient_id, reason, priority)
    values (${f.otherConversationId}, ${f.otherClinicPatientId}, 'chest pain', 'emergency')
    returning id`;
  return e.id;
}

test("patient search and lookup are scoped", async () => {
  assert.equal((await searchPatients(db, A(), "receptionist", f.clinicId, "chetan")).length, 0);
  assert.equal(await getPatient(db, A(), "receptionist", f.clinicId, f.otherClinicPatientId), null);
});

test("the escalation inbox shows only this clinic's escalations", async () => {
  await escalationAtOtherClinic();
  assert.equal((await listEscalations(db, A(), "receptionist", f.clinicId)).length, 0);
});

test("a stranger's escalation cannot be acknowledged or resolved", async () => {
  const id = await escalationAtOtherClinic();
  await assert.rejects(
    acknowledgeEscalation(db, A(), "receptionist", f.clinicId, id, f.receptionistId), NotFound);
  await assert.rejects(
    resolveEscalation(db, A(), "receptionist", f.clinicId, id), NotFound);

  const [row] = await db<{ status: string }[]>`select status from escalations where id = ${id}`;
  assert.equal(row.status, "open", "another clinic's emergency must stay open");
});

test("the calendar query never crosses clinics", async () => {
  await bookAppointment(db, { kind: "staff", id: f.otherStaffId }, "receptionist",
    { patientId: f.otherClinicPatientId, doctorId: f.otherDoctorId, startsAt: futureSlot(10) });

  const rows = await db`
    select a.id from appointments a join patients p on p.id = a.patient_id
     where a.clinic_id = ${f.clinicId} and p.deleted_at is null`;
  assert.equal(rows.length, 0);
});

test("a prescription cannot be written against another clinic's patient", async () => {
  // The doctor belongs to clinic A, the patient to clinic B. Nothing sensible
  // can come of this, so it must not be storable.
  await assert.rejects(
    createPrescription(db, { kind: "staff", id: f.doctorUserId }, "doctor", {
      patientId: f.otherClinicPatientId, doctorId: f.doctorId,
      drugName: "Amoxicillin", dosage: "500mg",
    }),
  );
  assert.equal((await db`select id from prescriptions`).length, 0);
});

test("prescriptions cannot be listed across a clinic boundary", async () => {
  // The prescription genuinely exists, for clinic B's own doctor/patient pair.
  await db`
    insert into prescriptions (patient_id, doctor_id, drug_name, dosage, created_by)
    values (${f.otherClinicPatientId}, ${f.otherDoctorId}, 'Amoxicillin', '500mg', ${f.otherStaffId})`;

  const rows = await listPrescriptions(db, A(), "receptionist", f.clinicId, f.otherClinicPatientId);
  assert.equal(rows.length, 0);
});

test("a prescription cannot be discontinued through another clinic's staff", async () => {
  // Prescription genuinely belongs to clinic B's own doctor/patient pair.
  const [row0] = await db<{ id: string }[]>`
    insert into prescriptions (patient_id, doctor_id, drug_name, dosage, created_by)
    values (${f.otherClinicPatientId}, ${f.otherDoctorId}, 'Amoxicillin', '500mg', ${f.otherStaffId})
    returning id`;

  await assert.rejects(
    discontinuePrescription(db, { kind: "staff", id: f.doctorUserId }, "doctor", f.clinicId, row0.id),
  );

  const [row] = await db<{ status: string }[]>`
    select status from prescriptions where id = ${row0.id}`;
  assert.equal(row.status, "active", "another clinic's prescription must not be touched");
});
