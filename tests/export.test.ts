import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, reset, seed, futureSlot, localDay, closeAll, type Fixture } from "./helpers";
import { toCsv, exportPatients, exportAppointments } from "../src/lib/export";
import { DeskError } from "../src/lib/desk";

let f: Fixture;
const DESK = () => ({ kind: "staff" as const, id: f.receptionistId });
const lines = (csv: string) => csv.split("\r\n").filter(Boolean);

beforeEach(async () => { await reset(); f = await seed(); });
after(closeAll);

test("toCsv quotes commas, quotes and newlines, with CRLF rows", () => {
  const csv = toCsv([{ a: 'x,y', b: 'say "hi"', c: "l1\nl2", d: "plain" }], ["a", "b", "c", "d"]);
  assert.equal(csv, 'a,b,c,d\r\n"x,y","say ""hi""","l1\nl2",plain\r\n');
});

test("toCsv neutralises formula starters and renders null as empty", () => {
  const csv = toCsv([{ a: "=1+1", b: "+91 90000", c: "-2", d: "@x", e: null, f: "\tz" }],
    ["a", "b", "c", "d", "e", "f"]);
  assert.equal(csv, "a,b,c,d,e,f\r\n'=1+1,'+91 90000,'-2,'@x,,'\tz\r\n");
});

test("the patients export is audited, and a doctor gets only his own patients", async () => {
  const at = futureSlot(10);
  await db`insert into appointments (clinic_id, doctor_id, patient_id, starts_at, ends_at, created_by)
           values (${f.clinicId}, ${f.doctorId}, ${f.patientId}, ${at}, ${new Date(at.getTime() + 1_800_000)}, 'agent')`;
  const all = lines(await exportPatients(db, DESK(), "receptionist", f.clinicId, "Asia/Kolkata"));
  assert.equal(all[0], "name,phone,consent_status,registered_on,next_appointment,active_prescriptions");
  assert.equal(all.length, 3);
  const mine = lines(await exportPatients(db, { kind: "staff", id: f.doctorUserId }, "doctor",
    f.clinicId, "Asia/Kolkata", f.doctorId));
  assert.equal(mine.length, 2);
  assert.ok(mine[1].includes(localDay(at)));
  const a = await db`select 1 from audit_log where action = 'export_patients'`;
  assert.equal(a.length, 2);
});

test("a soft-deleted patient is not exported", async () => {
  await db`update patients set deleted_at = now() where id = ${f.otherPatientId}`;
  const csv = lines(await exportPatients(db, DESK(), "receptionist", f.clinicId, "Asia/Kolkata"));
  assert.equal(csv.length, 2);
});

test("the appointments export covers the range, scoped to a doctor, with booked_by", async () => {
  const at = futureSlot(10);
  const [d2] = await db<{ id: string }[]>`
    insert into doctors (clinic_id, name, specialty, default_slot_minutes)
    values (${f.clinicId}, 'Dr Second', 'ENT', 30) returning id`;
  await db`insert into appointments (clinic_id, doctor_id, patient_id, starts_at, ends_at, created_by)
           values (${f.clinicId}, ${f.doctorId}, ${f.patientId}, ${at}, ${new Date(at.getTime() + 1_800_000)}, 'agent'),
                  (${f.clinicId}, ${d2.id}, ${f.otherPatientId}, ${new Date(at.getTime() + 3_600_000)},
                   ${new Date(at.getTime() + 5_400_000)}, ${f.receptionistId})`;
  const day = localDay(at);
  const csv = lines(await exportAppointments(db, DESK(), "receptionist", f.clinicId, "Asia/Kolkata", day, day));
  assert.equal(csv[0], "date,time,doctor,patient,phone,status,arrived,reason,booked_by");
  assert.equal(csv.length, 3);
  assert.ok(csv[1].includes("AI assistant"));
  assert.ok(!csv[2].includes("AI assistant"));
  const mine = lines(await exportAppointments(db, { kind: "staff", id: f.doctorUserId }, "doctor",
    f.clinicId, "Asia/Kolkata", day, day, f.doctorId));
  assert.equal(mine.length, 2);
  const none = lines(await exportAppointments(db, DESK(), "receptionist", f.clinicId, "Asia/Kolkata",
    localDay(new Date(at.getTime() + 20 * 86_400_000)), localDay(new Date(at.getTime() + 21 * 86_400_000))));
  assert.equal(none.length, 1);
  const a = await db`select 1 from audit_log where action = 'export_appointments'`;
  assert.equal(a.length, 3);
});

test("a range longer than 92 days, reversed, or malformed is refused", async () => {
  const run = (from: string, to: string) =>
    exportAppointments(db, DESK(), "receptionist", f.clinicId, "Asia/Kolkata", from, to);
  await assert.rejects(run("2026-01-01", "2026-06-01"), (e) => e instanceof DeskError);
  await assert.rejects(run("2026-02-01", "2026-01-01"), (e) => e instanceof DeskError);
  await assert.rejects(run("nope", "2026-01-01"), (e) => e instanceof DeskError);
  await run("2026-01-01", "2026-04-02"); // exactly 92 days inclusive
});
