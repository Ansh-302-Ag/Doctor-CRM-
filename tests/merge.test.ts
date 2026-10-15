import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, reset, seed, futureSlot, closeAll, type Fixture } from "./helpers";
import { previewMerge, mergePatients } from "../src/lib/merge";
import { DeskError } from "../src/lib/desk";
import { Forbidden } from "../src/lib/rbac";

let f: Fixture;
const DESK = () => ({ kind: "staff" as const, id: f.receptionistId });
const refused = (msg: RegExp) => (e: unknown) => e instanceof DeskError && msg.test(e.message);

beforeEach(async () => { await reset(); f = await seed(); });
after(closeAll);

const book = (patientId: string, doctorId: string, at: Date) => db`
  insert into appointments (clinic_id, doctor_id, patient_id, starts_at, ends_at, created_by)
  values (${f.clinicId}, ${doctorId}, ${patientId}, ${at}, ${new Date(at.getTime() + 1_800_000)}, 'agent')
  returning id`;

/** The duplicate (Bilal, the seed's second patient) gets one of everything. */
async function fillDrop() {
  const drop = f.otherPatientId;
  const [appt] = await book(drop, f.doctorId, futureSlot(11));
  const [conv] = await db<{ id: string }[]>`
    insert into conversations (patient_id) values (${drop}) returning id`;
  await db`insert into messages (conversation_id, direction, body)
           values (${conv.id}, 'inbound', 'hi'), (${conv.id}, 'outbound', 'hello')`;
  await db`insert into escalations (conversation_id, patient_id, reason)
           values (${conv.id}, ${drop}, 'call me')`;
  await db`insert into prescriptions (patient_id, doctor_id, drug_name, dosage, created_by)
           values (${drop}, ${f.doctorId}, 'Paracetamol', '1 tab', ${f.doctorUserId})`;
  await db`insert into reminders (patient_id, type, related_id, send_at)
           values (${drop}, 'appointment', ${appt.id}, now() + interval '1 day')`;
  await db`insert into consent_log (patient_id, action, notice_version, channel)
           values (${drop}, 'granted', 'v', 'desk')`;
  await db`insert into patient_notes (patient_id, body, created_by)
           values (${drop}, 'prefers mornings', ${f.receptionistId})`;
  await db`insert into tasks (clinic_id, patient_id, title, created_by)
           values (${f.clinicId}, ${drop}, 'call back', ${f.receptionistId})`;
  return conv.id;
}

const ONE_EACH = {
  appointments: 1, conversations: 1, messages: 2, prescriptions: 1, reminders: 1,
  escalations: 1, consents: 1, notes: 1, tasks: 1,
};

test("the preview counts what the duplicate would bring", async () => {
  await fillDrop();
  const counts = await previewMerge(db, DESK(), "receptionist", f.clinicId, f.patientId, f.otherPatientId);
  assert.deepEqual(counts, ONE_EACH);
  const audits = await db`select target_id from audit_log where action = 'preview_merge'`;
  assert.equal(audits.length, 2);
});

test("a merge moves every row to the kept record and deletes the duplicate", async () => {
  const conv = await fillDrop();
  const keep = f.patientId, drop = f.otherPatientId;
  const counts = await mergePatients(db, DESK(), "receptionist", f.clinicId, keep, drop);
  assert.deepEqual(counts, ONE_EACH);

  for (const t of ["appointments", "prescriptions", "reminders", "escalations",
                   "consent_log", "patient_notes", "tasks", "conversations"]) {
    const [r] = await db<{ n: number }[]>`select count(*)::int as n from ${db(t)} where patient_id = ${drop}`;
    assert.equal(r.n, 0, t);
  }
  assert.equal((await db`select 1 from patients where id = ${drop}`).length, 0);
  // Seeded Asha already has a WhatsApp conversation: Bilal's messages join it.
  const [{ n }] = await db<{ n: number }[]>`
    select count(*)::int as n from messages m join conversations c on c.id = m.conversation_id
     where c.patient_id = ${keep}`;
  assert.equal(n, 2);
  assert.equal((await db`select 1 from conversations where id = ${conv}`).length, 0);
  const [esc] = await db`select conversation_id, patient_id from escalations`;
  assert.equal(esc.conversation_id, f.conversationId);
  assert.equal(esc.patient_id, keep);

  const audits = await db`select target_id from audit_log where action = 'merge_patients' order by target_id`;
  assert.deepEqual(audits.map(a => a.target_id).sort(), [keep, drop].sort());
});

test("a conversation on a channel the kept record lacks is re-pointed whole", async () => {
  const [conv] = await db<{ id: string }[]>`
    insert into conversations (patient_id, channel) values (${f.otherPatientId}, 'voice') returning id`;
  await mergePatients(db, DESK(), "receptionist", f.clinicId, f.patientId, f.otherPatientId);
  const [c] = await db`select patient_id from conversations where id = ${conv.id}`;
  assert.equal(c.patient_id, f.patientId);
});

test("consent becomes granted if the duplicate had it; a missing name is filled", async () => {
  await db`update patients set consent_status = 'pending', consent_recorded_at = null, name = null
            where id = ${f.patientId}`;
  await mergePatients(db, DESK(), "receptionist", f.clinicId, f.patientId, f.otherPatientId);
  const [p] = await db`select name, consent_status, consent_recorded_at from patients where id = ${f.patientId}`;
  assert.equal(p.consent_status, "granted");
  assert.ok(p.consent_recorded_at);
  assert.equal(p.name, "Bilal");
});

test("another clinic's patient, the same record twice, or a bad id are refused", async () => {
  const merge = (keep: string, drop: string) =>
    mergePatients(db, DESK(), "receptionist", f.clinicId, keep, drop);
  await assert.rejects(merge(f.patientId, f.otherClinicPatientId), refused(/patient not found/));
  await assert.rejects(merge(f.otherClinicPatientId, f.patientId), refused(/patient not found/));
  await assert.rejects(merge(f.patientId, f.patientId), refused(/itself/));
  await assert.rejects(merge(f.patientId, "nope"), refused(/patient not found/));
  await assert.rejects(
    previewMerge(db, DESK(), "receptionist", f.clinicId, f.patientId, f.otherClinicPatientId),
    refused(/patient not found/));
  await db`update patients set deleted_at = now() where id = ${f.otherPatientId}`;
  await assert.rejects(merge(f.patientId, f.otherPatientId), refused(/patient not found/));
  // Nothing moved, nothing deleted.
  assert.equal((await db`select 1 from patients where id = ${f.otherClinicPatientId}`).length, 1);
});

test("a doctor cannot merge", async () => {
  const doc = { kind: "staff" as const, id: f.doctorUserId };
  await assert.rejects(
    mergePatients(db, doc, "doctor", f.clinicId, f.patientId, f.otherPatientId),
    (e: unknown) => e instanceof Forbidden);
  await assert.rejects(
    previewMerge(db, doc, "doctor", f.clinicId, f.patientId, f.otherPatientId),
    (e: unknown) => e instanceof Forbidden);
});

// Re-pointing patient_id never changes an appointment's doctor or time, so the
// per-doctor no-overlap constraint cannot fire: two rows that coexisted before
// the merge coexist after it. Same-time bookings with different doctors survive.
test("overlapping bookings with different doctors both survive the merge", async () => {
  const [doc2] = await db<{ id: string }[]>`
    insert into doctors (clinic_id, name) values (${f.clinicId}, 'Dr. Iyer') returning id`;
  const at = futureSlot(10);
  await book(f.patientId, f.doctorId, at);
  await book(f.otherPatientId, doc2.id, at);
  await mergePatients(db, DESK(), "receptionist", f.clinicId, f.patientId, f.otherPatientId);
  const rows = await db`select 1 from appointments where patient_id = ${f.patientId} and status = 'booked'`;
  assert.equal(rows.length, 2);
});
