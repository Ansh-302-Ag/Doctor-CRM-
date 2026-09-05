import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, agentDb, reset, seed, closeAll, type Fixture } from "./helpers";
import {
  createPrescription, listPrescriptions, discontinuePrescription, InvalidPrescription,
} from "../src/lib/prescriptions";
import { Forbidden } from "../src/lib/rbac";

let f: Fixture;
beforeEach(async () => { await reset(); f = await seed(); });
after(closeAll);

const input = () => ({
  patientId: f.patientId, doctorId: f.doctorId,
  drugName: "Amoxicillin", dosage: "500mg twice daily", durationDays: 5,
});
const DOCTOR = () => ({ kind: "staff" as const, id: f.doctorUserId });

test("a doctor can record a prescription exactly as entered", async () => {
  const { id } = await createPrescription(db, DOCTOR(), "doctor", input());
  const [row] = await db<{ drug_name: string; dosage: string; duration_days: number;
                          status: string; created_by: string }[]>`
    select drug_name, dosage, duration_days, status, created_by from prescriptions where id = ${id}`;
  assert.equal(row.drug_name, "Amoxicillin");
  assert.equal(row.dosage, "500mg twice daily");
  assert.equal(row.duration_days, 5);
  assert.equal(row.status, "active");
  assert.equal(row.created_by, f.doctorUserId);
});

test("a receptionist cannot write a prescription", async () => {
  await assert.rejects(
    createPrescription(db, { kind: "staff", id: f.receptionistId }, "receptionist", input()),
    Forbidden,
  );
  assert.equal((await db`select id from prescriptions`).length, 0);
});

test("the agent cannot write a prescription, at either layer", async () => {
  await assert.rejects(
    // @ts-expect-error - the agent is deliberately not a valid actor here
    createPrescription(db, { kind: "agent" }, "agent", input()),
  );
  await assert.rejects(
    agentDb`insert into prescriptions (patient_id, doctor_id, drug_name, dosage, created_by)
            values (${f.patientId}, ${f.doctorId}, 'X', 'Y', ${f.doctorUserId})`,
    (e: { code?: string }) => e.code === "42501",
  );
});

test("empty drug name or dosage is refused before it reaches the record", async () => {
  for (const bad of [
    { ...input(), drugName: "" },
    { ...input(), drugName: "   " },
    { ...input(), dosage: "" },
    { ...input(), durationDays: 0 },
    { ...input(), durationDays: -3 },
  ]) {
    await assert.rejects(createPrescription(db, DOCTOR(), "doctor", bad), InvalidPrescription);
  }
  assert.equal((await db`select id from prescriptions`).length, 0);
});

test("listing returns newest first with the prescribing doctor's name", async () => {
  await createPrescription(db, DOCTOR(), "doctor", input());
  await createPrescription(db, DOCTOR(), "doctor",
    { ...input(), drugName: "Paracetamol", dosage: "650mg as needed" });

  const rows = await listPrescriptions(db, DOCTOR(), "doctor", f.patientId);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].drug_name, "Paracetamol");
  assert.equal(rows[0].doctor_name, "Dr. Rao");
});

test("discontinuing changes status and leaves the record intact", async () => {
  const { id } = await createPrescription(db, DOCTOR(), "doctor", input());
  await discontinuePrescription(db, DOCTOR(), "doctor", f.clinicId, id);

  const [row] = await db<{ status: string; drug_name: string }[]>`
    select status, drug_name from prescriptions where id = ${id}`;
  assert.equal(row.status, "discontinued");
  assert.equal(row.drug_name, "Amoxicillin", "the record is history, never erased");
});

test("every prescription read and write is audited", async () => {
  await createPrescription(db, DOCTOR(), "doctor", input());
  await listPrescriptions(db, { kind: "staff", id: f.receptionistId }, "receptionist", f.patientId);

  const rows = await db<{ actor: string; action: string }[]>`
    select actor, action from audit_log order by created_at`;
  const actions = [...rows].map(r => r.action);
  assert.ok(actions.includes("create_prescription"), actions.join(","));
  assert.ok(actions.includes("read_prescriptions"), actions.join(","));
  assert.ok([...rows].some(r => r.actor === f.receptionistId));
});
