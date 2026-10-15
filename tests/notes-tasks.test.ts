import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, agentDb, reset, seed, futureSlot, closeAll, type Fixture } from "./helpers";
import { addNote } from "../src/lib/notes";
import { createTask, completeTask, listTasks } from "../src/lib/tasks";
import { getTimeline } from "../src/lib/timeline";
import { DeskError } from "../src/lib/desk";
import { Forbidden } from "../src/lib/rbac";

let f: Fixture;
const DESK = () => ({ kind: "staff" as const, id: f.receptionistId });
const DOC = () => ({ kind: "staff" as const, id: f.doctorUserId });
const refused = (msg: RegExp) => (e: unknown) => e instanceof DeskError && msg.test(e.message);

beforeEach(async () => { await reset(); f = await seed(); });
after(closeAll);

/** Puts the seeded patient in the seeded doctor's scope. */
const bookWithDoctor = () => db`
  insert into appointments (clinic_id, doctor_id, patient_id, starts_at, ends_at, created_by)
  values (${f.clinicId}, ${f.doctorId}, ${f.patientId}, ${futureSlot()},
          ${new Date(futureSlot().getTime() + 1_800_000)}, 'agent')`;

test("a note is added, audited and shows on the timeline", async () => {
  const { id } = await addNote(db, DESK(), "receptionist", f.clinicId, f.patientId, "  Prefers mornings ");
  const items = await getTimeline(db, DESK(), "receptionist", f.clinicId, f.patientId, {});
  const note = items.find(i => i.refId === id)!;
  assert.equal(note.kind, "note");
  assert.equal(note.detail, "Prefers mornings");
  assert.equal(note.byName, "Front Desk");
  const [a] = await db`select 1 from audit_log where action = 'add_note' and target_id = ${f.patientId}`;
  assert.ok(a);
});

test("an empty or overlong note is refused", async () => {
  await assert.rejects(addNote(db, DESK(), "receptionist", f.clinicId, f.patientId, "   "),
    refused(/note is empty/));
  await assert.rejects(addNote(db, DESK(), "receptionist", f.clinicId, f.patientId, "x".repeat(2001)),
    refused(/too long/));
});

test("a note on another clinic's patient is refused", async () => {
  await assert.rejects(
    addNote(db, DESK(), "receptionist", f.clinicId, f.otherClinicPatientId, "hi"),
    refused(/patient not found/));
  await assert.rejects(addNote(db, DESK(), "receptionist", f.clinicId, "not-a-uuid", "hi"),
    refused(/patient not found/));
});

test("a doctor notes only his own patients", async () => {
  await assert.rejects(
    addNote(db, DOC(), "doctor", f.clinicId, f.patientId, "hi", f.doctorId),
    refused(/patient not found/));
  await bookWithDoctor();
  await addNote(db, DOC(), "doctor", f.clinicId, f.patientId, "hi", f.doctorId);
});

test("a task is created, validated and shows on the timeline", async () => {
  const { id } = await createTask(db, DESK(), "receptionist", f.clinicId, {
    title: "Call back with reports", patientId: f.patientId, dueOn: "2026-10-20",
    assignedTo: f.doctorUserId,
  });
  const items = await getTimeline(db, DESK(), "receptionist", f.clinicId, f.patientId, {});
  const task = items.find(i => i.refId === id)!;
  assert.equal(task.title, "Task: Call back with reports");
  assert.match(task.detail!, /due 20 Oct 2026/);

  // A general clinic task needs no patient.
  await createTask(db, DESK(), "receptionist", f.clinicId, { title: "Order gloves" });

  const bad = (input: Parameters<typeof createTask>[4], msg: RegExp) =>
    assert.rejects(createTask(db, DESK(), "receptionist", f.clinicId, input), refused(msg));
  await bad({ title: " " }, /title/);
  await bad({ title: "x".repeat(201) }, /too long/);
  await bad({ title: "t", dueOn: "2026-02-30" }, /due date/);
  await bad({ title: "t", assignedTo: f.otherStaffId }, /assignee/);
  await bad({ title: "t", patientId: f.otherClinicPatientId }, /patient not found/);
  // A doctor cannot attach a task to a patient outside his scope.
  await assert.rejects(createTask(db, DOC(), "doctor", f.clinicId,
    { title: "t", patientId: f.patientId }, f.doctorId), refused(/patient not found/));
});

test("completing a task sets done_at once; other clinics' tasks are refused", async () => {
  const { id } = await createTask(db, DESK(), "receptionist", f.clinicId, { title: "t" });
  await completeTask(db, DOC(), "doctor", f.clinicId, id);
  const [first] = await db<{ done_at: Date }[]>`select done_at from tasks where id = ${id}`;
  assert.ok(first.done_at);
  // Idempotent: a second click keeps the original time.
  await completeTask(db, DESK(), "receptionist", f.clinicId, id);
  const [again] = await db<{ done_at: Date }[]>`select done_at from tasks where id = ${id}`;
  assert.equal(again.done_at.getTime(), first.done_at.getTime());

  await assert.rejects(completeTask(db, DESK(), "receptionist", f.otherClinicId, id),
    refused(/task not found/));
});

test("a doctor can close only tasks he could see", async () => {
  const other = await createTask(db, DESK(), "receptionist", f.clinicId,
    { title: "about Bilal", patientId: f.otherPatientId });
  await assert.rejects(completeTask(db, DOC(), "doctor", f.clinicId, other.id, f.doctorId),
    refused(/not found/));
  const mine = await createTask(db, DESK(), "receptionist", f.clinicId,
    { title: "for the doctor", patientId: f.otherPatientId, assignedTo: f.doctorUserId });
  await completeTask(db, DOC(), "doctor", f.clinicId, mine.id, f.doctorId);
  await bookWithDoctor();
  const asha = await createTask(db, DESK(), "receptionist", f.clinicId,
    { title: "about Asha", patientId: f.patientId });
  await completeTask(db, DOC(), "doctor", f.clinicId, asha.id, f.doctorId);
});

test("listTasks filters by assignee and open, and stays in the clinic", async () => {
  const mine = await createTask(db, DESK(), "receptionist", f.clinicId,
    { title: "later", assignedTo: f.receptionistId, dueOn: "2026-12-01" });
  const soon = await createTask(db, DESK(), "receptionist", f.clinicId,
    { title: "soon", assignedTo: f.receptionistId, dueOn: "2026-10-01" });
  await createTask(db, DESK(), "receptionist", f.clinicId,
    { title: "undated", assignedTo: f.receptionistId });
  const done = await createTask(db, DESK(), "receptionist", f.clinicId,
    { title: "done", assignedTo: f.receptionistId });
  await completeTask(db, DESK(), "receptionist", f.clinicId, done.id);
  await db`insert into tasks (clinic_id, title, created_by, assigned_to)
           values (${f.otherClinicId}, 'rival', ${f.otherStaffId}, ${f.otherStaffId})`;

  const open = await listTasks(db, DESK(), "receptionist", f.clinicId,
    { assignedTo: f.receptionistId, open: true });
  assert.deepEqual(open.map(t => t.title), ["soon", "later", "undated"]);
  assert.equal(open[0].id, soon.id);
  assert.equal(open[0].due_on, "2026-10-01");
  assert.equal(open[0].overdue, true);
  assert.equal(open[1].id, mine.id);
  assert.equal(open[1].assignee_name, "Front Desk");

  const all = await listTasks(db, DESK(), "receptionist", f.clinicId, {});
  assert.equal(all.length, 4);
});

test("a doctor's task list excludes patients outside his scope", async () => {
  await createTask(db, DESK(), "receptionist", f.clinicId, { title: "about Asha", patientId: f.patientId });
  await createTask(db, DESK(), "receptionist", f.clinicId, { title: "general" });
  await createTask(db, DESK(), "receptionist", f.clinicId,
    { title: "for the doctor", patientId: f.otherPatientId, assignedTo: f.doctorUserId });

  const titles = async () => (await listTasks(db, DOC(), "doctor", f.clinicId, {}, f.doctorId))
    .map(t => t.title).sort();
  assert.deepEqual(await titles(), ["for the doctor", "general"]);
  await bookWithDoctor();
  assert.deepEqual(await titles(), ["about Asha", "for the doctor", "general"]);

  const forPatient = await listTasks(db, DESK(), "receptionist", f.clinicId, { patientId: f.patientId });
  assert.deepEqual(forPatient.map(t => t.title), ["about Asha"]);
  assert.equal(forPatient[0].patient_name, "Asha");
});

test("the agent role and the agent DB role are denied", async () => {
  await assert.rejects(addNote(db, { kind: "agent" }, "agent", f.clinicId, f.patientId, "hi"), Forbidden);
  await assert.rejects(createTask(db, { kind: "agent" }, "agent", f.clinicId, { title: "t" }), Forbidden);
  await assert.rejects(listTasks(db, { kind: "agent" }, "agent", f.clinicId, {}), Forbidden);
  const denied = (e: { code?: string }) => e.code === "42501";
  await assert.rejects(agentDb`insert into patient_notes (patient_id, body, created_by)
                               values (${f.patientId}, 'x', ${f.receptionistId})`, denied);
  await assert.rejects(agentDb`update tasks set done_at = now()`, denied);
});
