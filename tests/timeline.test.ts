import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, reset, seed, closeAll, type Fixture } from "./helpers";
import { getTimeline } from "../src/lib/timeline";

let f: Fixture;
const DESK = () => ({ kind: "staff" as const, id: f.receptionistId });
const DOC = () => ({ kind: "staff" as const, id: f.doctorUserId });

beforeEach(async () => { await reset(); f = await seed(); });
after(closeAll);

/** One row from every source, each a minute apart, oldest first:
 *  booked appt, consent, inbound msg, outbound msg, escalation, prescription,
 *  note, task, then the appointment's arrival and its outcome. */
async function history() {
  const t = (min: number) => new Date(Date.UTC(2026, 9, 1, 4, min));  // 09:30 IST + min
  const [appt] = await db<{ id: string }[]>`
    insert into appointments (clinic_id, doctor_id, patient_id, starts_at, ends_at,
                              reason_text, created_by, created_at, arrived_at, status, updated_at)
    values (${f.clinicId}, ${f.doctorId}, ${f.patientId},
            '2026-10-02T04:30:00Z', '2026-10-02T05:00:00Z', 'fever', 'agent',
            ${t(0)}, ${t(8)}, 'completed', ${t(9)})
    returning id`;
  await db`insert into consent_log (patient_id, action, notice_version, channel, created_at)
           values (${f.patientId}, 'granted', 'v1', 'whatsapp', ${t(1)})`;
  await db`insert into messages (conversation_id, direction, body, created_at)
           values (${f.conversationId}, 'inbound', ${"hello ".repeat(40)}, ${t(2)}),
                  (${f.conversationId}, 'outbound', 'Hi Asha', ${t(3)})`;
  await db`insert into escalations (conversation_id, patient_id, reason, created_at)
           values (${f.conversationId}, ${f.patientId}, 'wants a human', ${t(4)})`;
  await db`insert into prescriptions (patient_id, doctor_id, drug_name, dosage, created_by, created_at)
           values (${f.patientId}, ${f.doctorId}, 'Paracetamol', '500mg', ${f.doctorUserId}, ${t(5)})`;
  await db`insert into patient_notes (patient_id, body, created_by, created_at)
           values (${f.patientId}, 'Prefers mornings', ${f.receptionistId}, ${t(6)})`;
  await db`insert into tasks (clinic_id, patient_id, title, created_by, created_at)
           values (${f.clinicId}, ${f.patientId}, 'Call back with reports', ${f.receptionistId}, ${t(7)})`;
  return appt.id;
}

test("every source appears, newest first, with who did it", async () => {
  const apptId = await history();
  const items = await getTimeline(db, DESK(), "receptionist", f.clinicId, f.patientId, {});
  assert.deepEqual(items.map(i => i.kind), [
    "appointment", "appointment", "task", "note", "prescription",
    "escalation", "message", "message", "consent", "appointment",
  ]);
  for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].at >= items[i].at);

  const booked = items.at(-1)!;
  assert.equal(booked.refId, apptId);
  assert.equal(booked.by, "agent");
  assert.equal(booked.byName, "AI assistant");
  // Local clinic time and the doctor, not UTC.
  assert.match(booked.title, /2 Oct 2026, 10:00/);
  assert.match(booked.title, /Dr\. Rao/);
  assert.match(items[0].title, /^Completed/);
  assert.match(items[1].title, /^Arrived/);

  const inbound = items[7];
  assert.equal(inbound.by, "patient");
  assert.ok(inbound.title.length <= 141);
  assert.equal(inbound.detail, "hello ".repeat(40));
  assert.equal(items[6].by, "agent");

  assert.equal(items[4].byName, "Dr. Rao");     // prescription
  assert.equal(items[3].byName, "Front Desk");  // note
});

test("before pages through older items without gaps", async () => {
  await history();
  const all = await getTimeline(db, DESK(), "receptionist", f.clinicId, f.patientId, {});
  const first = await getTimeline(db, DESK(), "receptionist", f.clinicId, f.patientId, { limit: 4 });
  const rest = await getTimeline(db, DESK(), "receptionist", f.clinicId, f.patientId,
    { before: first.at(-1)!.at });
  assert.equal(first.length, 4);
  assert.deepEqual([...first, ...rest].map(i => i.title), all.map(i => i.title));
});

test("a page never splits items that share a timestamp", async () => {
  // A reschedule writes the new booking and the old one's outcome in one now().
  for (let i = 0; i < 3; i++) {
    await db`insert into patient_notes (patient_id, body, created_by, created_at)
             values (${f.patientId}, ${`n${i}`}, ${f.receptionistId}, '2026-10-01T05:00:00Z')`;
  }
  const first = await getTimeline(db, DESK(), "receptionist", f.clinicId, f.patientId, { limit: 2 });
  const rest = await getTimeline(db, DESK(), "receptionist", f.clinicId, f.patientId,
    { before: first.at(-1)!.at });
  assert.equal(first.length + rest.length, 3);
});

test("the desk sees escalations, a doctor does not", async () => {
  await history();
  const desk = await getTimeline(db, DESK(), "receptionist", f.clinicId, f.patientId, {});
  const doc = await getTimeline(db, DOC(), "doctor", f.clinicId, f.patientId, { doctorId: f.doctorId });
  assert.ok(desk.some(i => i.kind === "escalation"));
  assert.ok(!doc.some(i => i.kind === "escalation"));
  assert.equal(doc.length, desk.length - 1);
});

test("another clinic's patient has no timeline", async () => {
  await db`insert into patient_notes (patient_id, body, created_by)
           values (${f.otherClinicPatientId}, 'secret', ${f.otherStaffId})`;
  assert.deepEqual(
    await getTimeline(db, DESK(), "receptionist", f.clinicId, f.otherClinicPatientId, {}), []);
});

test("a doctor gets nothing for a patient who never saw him", async () => {
  await db`insert into patient_notes (patient_id, body, created_by)
           values (${f.otherPatientId}, 'note', ${f.receptionistId})`;
  assert.deepEqual(await getTimeline(db, DOC(), "doctor", f.clinicId, f.otherPatientId,
    { doctorId: f.doctorId }), []);
});

test("reading a timeline is audited", async () => {
  await getTimeline(db, DESK(), "receptionist", f.clinicId, f.patientId, {});
  const rows = await db`select 1 from audit_log
                         where action = 'read_timeline' and target_id = ${f.patientId}`;
  assert.equal(rows.length, 1);
});
