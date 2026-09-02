/**
 * The guarantees docs/08 says must hold independently of application code.
 * If any of these fail, the safety story of the product is not true.
 */
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, agentDb, reset, seed, futureSlot, closeAll, type Fixture } from "./helpers";
import { can } from "../src/lib/rbac";

let f: Fixture;
beforeEach(async () => { await reset(); f = await seed(); });
after(closeAll);

const isPermissionDenied = (e: unknown) => (e as { code?: string }).code === "42501";

test("the agent's DB role cannot INSERT a prescription", async () => {
  await assert.rejects(
    agentDb`insert into prescriptions (patient_id, doctor_id, drug_name, dosage, created_by)
            values (${f.patientId}, ${f.doctorId}, 'Amoxicillin', '500mg twice daily',
                    ${f.doctorUserId})`,
    isPermissionDenied,
  );
});

test("the agent's DB role cannot UPDATE or DELETE a prescription", async () => {
  const [p] = await db<{ id: string }[]>`
    insert into prescriptions (patient_id, doctor_id, drug_name, dosage, created_by)
    values (${f.patientId}, ${f.doctorId}, 'Amoxicillin', '500mg twice daily', ${f.doctorUserId})
    returning id`;

  await assert.rejects(
    agentDb`update prescriptions set dosage = '1000mg' where id = ${p.id}`, isPermissionDenied);
  await assert.rejects(
    agentDb`delete from prescriptions where id = ${p.id}`, isPermissionDenied);

  const [after_] = await db<{ dosage: string }[]>`select dosage from prescriptions where id = ${p.id}`;
  assert.equal(after_.dosage, "500mg twice daily");
});

test("the agent's DB role CAN read prescriptions", async () => {
  await db`insert into prescriptions (patient_id, doctor_id, drug_name, dosage, created_by)
           values (${f.patientId}, ${f.doctorId}, 'Amoxicillin', '500mg twice daily',
                   ${f.doctorUserId})`;
  const rows = await agentDb`select drug_name, dosage from prescriptions
                              where patient_id = ${f.patientId}`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].drug_name, "Amoxicillin");
});

test("the agent's DB role can create an escalation but cannot resolve one", async () => {
  const [e] = await agentDb<{ id: string }[]>`
    insert into escalations (conversation_id, patient_id, reason)
    values (${f.conversationId}, ${f.patientId}, 'clinical question') returning id`;
  assert.ok(e.id);

  await assert.rejects(
    agentDb`update escalations set status = 'resolved' where id = ${e.id}`, isPermissionDenied);
});

test("the agent's DB role cannot rewrite the audit trail or delete appointments", async () => {
  await agentDb`insert into audit_log (actor, action, target_table, target_id)
                values ('agent', 'test', 'patients', ${f.patientId})`;
  await assert.rejects(agentDb`update audit_log set actor = 'someone else'`, isPermissionDenied);
  await assert.rejects(agentDb`delete from audit_log`, isPermissionDenied);
  await assert.rejects(agentDb`delete from appointments`, isPermissionDenied);
  await assert.rejects(agentDb`update consent_log set action = 'granted'`, isPermissionDenied);
});

test("the agent's DB role cannot touch staff accounts", async () => {
  await assert.rejects(agentDb`select password_hash from staff_users`, isPermissionDenied);
  await assert.rejects(
    agentDb`update staff_users set role = 'admin' where id = ${f.receptionistId}`,
    isPermissionDenied);
});

test("the application role matrix agrees with the database grants", () => {
  assert.equal(can("agent", "prescriptions:write"), false);
  assert.equal(can("agent", "escalations:resolve"), false);
  assert.equal(can("receptionist", "prescriptions:write"), false);
  assert.equal(can("doctor", "prescriptions:write"), true);
  assert.equal(can("admin", "prescriptions:write"), true);
});

test("the exclusion constraint holds against raw SQL, not just the booking helper", async () => {
  const at = futureSlot(10), end = new Date(futureSlot(10).getTime() + 30 * 60_000);
  const insert = () => db`
    insert into appointments (clinic_id, doctor_id, patient_id, starts_at, ends_at, created_by)
    values (${f.clinicId}, ${f.doctorId}, ${f.patientId}, ${at}, ${end}, 'agent')`;
  await insert();
  await assert.rejects(insert(), (e: { code?: string }) => e.code === "23P01");
});

test("prescriptions.created_by cannot be the agent — the column only accepts staff", async () => {
  await assert.rejects(
    db`insert into prescriptions (patient_id, doctor_id, drug_name, dosage, created_by)
       values (${f.patientId}, ${f.doctorId}, 'X', 'Y', ${f.patientId})`,
    (e: { code?: string }) => e.code === "23503",   // foreign key violation
  );
});
