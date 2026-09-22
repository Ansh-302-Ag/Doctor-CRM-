/**
 * The doctor's half of the CRM: what he may see, whose patients they are, and
 * what reaches the patient when he prescribes.
 */
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, reset, seed, closeAll, type Fixture } from "./helpers";
import { hashPassword } from "../src/lib/password";
import { can, Forbidden } from "../src/lib/rbac";
import { listEscalations } from "../src/lib/escalations";
import { getPatient, searchPatients, patientScope } from "../src/lib/patients";
import {
  doctorQueue, nextInQueue, prescribeAndNotify, prescriptionMessage, NotYourPatient,
} from "../src/lib/doctor";

let f: Fixture;
let second: { doctorId: string; userId: string };

const DAY = "2026-09-22";
const at = (hour: number) => new Date(`${DAY}T${String(hour).padStart(2, "0")}:00:00+05:30`);
const TZ = "Asia/Kolkata";

const doctorStaff = () => ({
  id: f.doctorUserId, role: "doctor" as const, clinicId: f.clinicId,
  doctorId: f.doctorId, timezone: TZ,
});
const actor = () => ({ kind: "staff" as const, id: f.doctorUserId });

/** A second doctor at the same clinic — the point of most of these tests. */
async function seedSecondDoctor() {
  const [doctor] = await db<{ id: string }[]>`
    insert into doctors (clinic_id, name, specialty, default_slot_minutes)
    values (${f.clinicId}, 'Dr. Iyer', 'Paediatrics', 20) returning id`;
  const [user] = await db<{ id: string }[]>`
    insert into staff_users (clinic_id, name, email, password_hash, role, doctor_id)
    values (${f.clinicId}, 'Dr. Iyer', 'iyer@test.clinic',
            ${await hashPassword("correct horse")}, 'doctor', ${doctor.id})
    returning id`;
  return { doctorId: doctor.id, userId: user.id };
}

async function book(doctorId: string, patientId: string, hour: number, status = "booked") {
  const [row] = await db<{ id: string }[]>`
    insert into appointments (clinic_id, doctor_id, patient_id, starts_at, ends_at, status, reason_text, created_by)
    values (${f.clinicId}, ${doctorId}, ${patientId}, ${at(hour)}, ${at(hour + 1)},
            ${status}::appointment_status, 'sore throat', 'agent')
    returning id`;
  return row.id;
}

/** The patient messaged the clinic `hoursAgo` hours ago — what opens the
 *  24-hour window WhatsApp allows free-form replies in. */
async function patientMessagedAgo(hoursAgo: number, now: Date) {
  await db`
    insert into messages (conversation_id, direction, body, created_at)
    values (${f.conversationId}, 'inbound', 'hello',
            ${new Date(now.getTime() - hoursAgo * 3_600_000)})`;
}

const input = () => ({
  patientId: f.patientId, doctorId: f.doctorId,
  drugName: "Amoxicillin", dosage: "500mg twice daily", durationDays: 5,
  notes: "after food",
});

/** Records what the channel was asked to send, without sending anything. */
function spy() {
  const free: { to: string; text: string }[] = [];
  const templates: { to: string; name: string; parameters: string[] }[] = [];
  return {
    free, templates,
    send: async (m: { to: string; text: string }) => { free.push(m); return { delivered: true }; },
    sendT: async (m: { to: string; name: string; parameters: string[] }) => {
      templates.push(m); return { delivered: true };
    },
  };
}

beforeEach(async () => { await reset(); f = await seed(); second = await seedSecondDoctor(); });
after(closeAll);

// ---------------------------------------------------------------- escalations

test("a doctor has no escalation inbox; reception and admin do", () => {
  for (const p of ["escalations:read", "escalations:resolve"] as const) {
    assert.equal(can("doctor", p), false, `doctor must not have ${p}`);
    assert.equal(can("receptionist", p), true);
    assert.equal(can("admin", p), true);
  }
  // What he does keep.
  assert.equal(can("doctor", "prescriptions:write"), true);
  assert.equal(can("doctor", "escalations:create"), true);
});

test("the escalation list refuses a doctor at the library, not just in the nav", async () => {
  await db`insert into escalations (conversation_id, patient_id, reason, priority)
           values (${f.conversationId}, ${f.patientId}, 'chest pain', 'emergency')`;

  await assert.rejects(listEscalations(db, actor(), "doctor", f.clinicId), Forbidden);
  assert.equal((await listEscalations(db, actor(), "receptionist", f.clinicId)).length, 1);
});

// --------------------------------------------------------------------- queue

test("a doctor's queue is his own day, in time order, and another doctor's differs", async () => {
  await book(f.doctorId, f.patientId, 11);
  await book(f.doctorId, f.otherPatientId, 9);
  await book(second.doctorId, f.otherPatientId, 10);

  const mine = await doctorQueue(db, actor(), f.clinicId, f.doctorId, DAY, TZ);
  assert.deepEqual(mine.map(r => r.patient_name), ["Bilal", "Asha"]);

  const theirs = await doctorQueue(db, actor(), f.clinicId, second.doctorId, DAY, TZ);
  assert.deepEqual(theirs.map(r => r.patient_name), ["Bilal"]);
  assert.equal(theirs.length, 1);
});

test("the queue leaves out cancellations, other days and deleted patients", async () => {
  await book(f.doctorId, f.patientId, 9, "cancelled");
  await book(f.doctorId, f.otherPatientId, 10);
  await db`update patients set deleted_at = now() where id = ${f.otherPatientId}`;

  assert.equal((await doctorQueue(db, actor(), f.clinicId, f.doctorId, DAY, TZ)).length, 0);
  assert.equal((await doctorQueue(db, actor(), f.clinicId, f.doctorId, "2026-09-23", TZ)).length, 0);
});

test("who is next is the first booked appointment still to come", async () => {
  await book(f.doctorId, f.patientId, 9);
  await book(f.doctorId, f.otherPatientId, 11, "completed");
  await book(f.doctorId, f.otherPatientId, 12);

  const rows = await doctorQueue(db, actor(), f.clinicId, f.doctorId, DAY, TZ);
  assert.equal(nextInQueue(rows, at(10))!.starts_at.getTime(), at(12).getTime());
  assert.equal(nextInQueue(rows, at(8))!.starts_at.getTime(), at(9).getTime());
  assert.equal(nextInQueue(rows, at(13)), null, "nothing left today");
});

test("reading a queue is audited", async () => {
  await doctorQueue(db, actor(), f.clinicId, f.doctorId, DAY, TZ);
  const rows = await db<{ action: string }[]>`select action from audit_log`;
  assert.ok([...rows].some(r => r.action === "read_doctor_queue"));
});

// ------------------------------------------------------------- whose patients

test("a doctor can only open a patient who has an appointment with him", async () => {
  const scope = patientScope(doctorStaff());
  assert.equal(await getPatient(db, actor(), "doctor", f.clinicId, f.patientId, scope), null);

  await book(f.doctorId, f.patientId, 9);
  assert.ok(await getPatient(db, actor(), "doctor", f.clinicId, f.patientId, scope));

  // Booked with his colleague, so still not his.
  await book(second.doctorId, f.otherPatientId, 10);
  assert.equal(await getPatient(db, actor(), "doctor", f.clinicId, f.otherPatientId, scope), null);
});

test("a doctor cannot reach another clinic's patient even by id", async () => {
  await db`
    insert into appointments (clinic_id, doctor_id, patient_id, starts_at, ends_at, created_by)
    values (${f.otherClinicId}, ${f.otherDoctorId}, ${f.otherClinicPatientId},
            ${at(9)}, ${at(10)}, 'agent')`;
  assert.equal(
    await getPatient(db, actor(), "doctor", f.clinicId, f.otherClinicPatientId, f.doctorId), null);
});

test("the patient list is scoped the same way, and reception still sees everyone", async () => {
  await book(f.doctorId, f.patientId, 9);
  const mine = await searchPatients(db, actor(), "doctor", f.clinicId, "", f.doctorId);
  assert.deepEqual(mine.map(p => p.name), ["Asha"]);

  const desk = await searchPatients(
    db, { kind: "staff", id: f.receptionistId }, "receptionist", f.clinicId, "",
    patientScope({ role: "receptionist", doctorId: null }));
  assert.equal(desk.length, 2);
});

// --------------------------------------------------------------- prescribing

test("a prescription is attributed to the signed-in doctor, whatever the form says", async () => {
  await book(f.doctorId, f.patientId, 9);
  const io = spy();
  const { id } = await prescribeAndNotify(
    db, doctorStaff(), { ...input(), doctorId: second.doctorId }, io);

  const [row] = await db<{ doctor_id: string; created_by: string }[]>`
    select doctor_id, created_by from prescriptions where id = ${id}`;
  assert.equal(row.doctor_id, f.doctorId, "his own, not the one named in the form");
  assert.equal(row.created_by, f.doctorUserId);
});

test("a doctor cannot prescribe for someone who is not his patient", async () => {
  const io = spy();
  await assert.rejects(prescribeAndNotify(db, doctorStaff(), input(), io), NotYourPatient);
  assert.equal((await db`select id from prescriptions`).length, 0);
  assert.equal(io.free.length, 0);
});

test("inside the 24-hour window the patient gets the record, verbatim", async () => {
  await book(f.doctorId, f.patientId, 9);
  const now = new Date();
  await patientMessagedAgo(2, now);

  const io = spy();
  const { delivery } = await prescribeAndNotify(db, doctorStaff(), input(), { ...io, now });

  assert.deepEqual(delivery, { delivered: true });
  assert.equal(io.templates.length, 0, "a prescription never goes out as a template");
  assert.equal(io.free.length, 1);
  const text = io.free[0].text;
  assert.match(text, /Amoxicillin/);
  assert.match(text, /500mg twice daily/);
  assert.match(text, /5 days/);
  assert.match(text, /after food/);
  assert.match(text, /Dr\. Rao/);
  assert.match(text, /\+911140000000/, "the clinic's own number, for questions");
  assert.doesNotMatch(text, /\b(should|recommend|advise|safe)\b/i, "it never advises");

  const audits = await db<{ action: string }[]>`select action from audit_log`;
  assert.ok([...audits].some(a => a.action === "prescription_message_sent"));
});

test("outside the window the record is still saved, and the nudge carries no clinical content", async () => {
  await book(f.doctorId, f.patientId, 9);
  const now = new Date();
  await patientMessagedAgo(25, now);

  const io = spy();
  const { id, delivery } = await prescribeAndNotify(db, doctorStaff(), input(), { ...io, now });

  assert.equal((await db`select id from prescriptions where id = ${id}`).length, 1);
  assert.deepEqual(delivery, { delivered: false, reason: "outside_window", nudged: true });
  assert.equal(io.free.length, 0, "free-form text outside the window would be refused by Meta");
  assert.equal(io.templates.length, 1);
  assert.equal(io.templates[0].name, "record_updated");
  assert.ok(!io.templates[0].parameters.some(p => /Amoxicillin|500mg/.test(p)),
    "a template must never carry the drug or the dose");
});

test("a patient who has never messaged the clinic is outside the window too", async () => {
  await book(f.doctorId, f.patientId, 9);
  const io = spy();
  const { delivery } = await prescribeAndNotify(db, doctorStaff(), input(), io);
  assert.equal(delivery.reason, "outside_window");
});

test("a WhatsApp failure never costs the clinic the prescription", async () => {
  await book(f.doctorId, f.patientId, 9);
  const now = new Date();
  await patientMessagedAgo(1, now);

  const { id, delivery } = await prescribeAndNotify(db, doctorStaff(), input(), {
    send: async () => { throw new Error("502 from Meta"); },
    now,
  });

  const [row] = await db<{ drug_name: string }[]>`
    select drug_name from prescriptions where id = ${id}`;
  assert.equal(row.drug_name, "Amoxicillin", "the record stands");
  assert.deepEqual(delivery, { delivered: false, reason: "send_failed", nudged: false });

  const audits = await db<{ action: string }[]>`select action from audit_log`;
  assert.ok([...audits].some(a => a.action === "create_prescription"));
  assert.ok([...audits].some(a => a.action === "prescription_message_failed"));
});

test("a channel that reports nothing was sent is not reported as sent", async () => {
  // Unconfigured WhatsApp returns {delivered:false} instead of throwing
  // (src/lib/channel.ts). The doctor must be told that, not congratulated.
  await book(f.doctorId, f.patientId, 9);
  const now = new Date();
  await patientMessagedAgo(1, now);

  const { id, delivery } = await prescribeAndNotify(db, doctorStaff(), input(), {
    send: async () => ({ delivered: false }), now,
  });
  assert.equal((await db`select id from prescriptions where id = ${id}`).length, 1);
  assert.deepEqual(delivery, { delivered: false, reason: "send_failed", nudged: false });
});

test("the message says who prescribed, when, and where to ask — and nothing else", () => {
  const text = prescriptionMessage({
    clinicName: "Sunrise Clinic", clinicPhone: "+911140001234", doctorName: "Dr. Rao",
    at: new Date("2026-09-22T10:30:00+05:30"), timezone: TZ,
    drugName: "Amoxicillin", dosage: "500mg twice daily", durationDays: 1, notes: null,
  });
  assert.match(text, /Dr\. Rao/);
  assert.match(text, /22 Sept? 2026/);
  assert.match(text, /1 day\b/, "singular, not '1 days'");
  assert.doesNotMatch(text, /Notes:/, "no empty fields");
  assert.match(text, /call the clinic on \+911140001234/);
});
