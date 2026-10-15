import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, reset, seed, localDay, closeAll, type Fixture } from "./helpers";
import { getInsights, noShowRate } from "../src/lib/insights";
import { OPEN_HOUR, CLOSE_HOUR } from "../src/lib/booking";
import { DeskError } from "../src/lib/desk";

let f: Fixture;
const TZ = "Asia/Kolkata";
const DESK = () => ({ kind: "staff" as const, id: f.receptionistId });

beforeEach(async () => { await reset(); f = await seed(); });
after(closeAll);

/** Today at `hour`:00 IST, `daysAgo` local days back. Past on purpose: insights look backwards. */
const at = (hour: number, daysAgo = 0) => {
  const day = localDay(new Date(Date.now() - daysAgo * 86_400_000));
  return new Date(`${day}T${String(hour).padStart(2, "0")}:00:00+05:30`);
};

/** Raw rows, not bookAppointment: past slots and every status are needed. Each
 *  appointment gets its own hour so the no-overlap constraint never bites. */
async function appt(o: {
  hour: number; daysAgo?: number; status?: string; by?: string;
  doctorId?: string; clinicId?: string; patientId?: string;
}) {
  const starts = at(o.hour, o.daysAgo);
  await db`insert into appointments (clinic_id, doctor_id, patient_id, starts_at, ends_at, status, created_by)
           values (${o.clinicId ?? f.clinicId}, ${o.doctorId ?? f.doctorId}, ${o.patientId ?? f.patientId},
                   ${starts}, ${new Date(starts.getTime() + 1_800_000)},
                   ${o.status ?? "booked"}::appointment_status, ${o.by ?? "agent"})`;
}

test("noShowRate is null with no outcomes", () => {
  assert.equal(noShowRate(0, 0), null);
  assert.equal(noShowRate(3, 1), 0.25);
});

test("counts by status, no-show rate, sources, hours and new patients", async () => {
  await appt({ hour: 9, status: "completed" });
  await appt({ hour: 10, status: "completed", by: f.receptionistId });
  await appt({ hour: 11, status: "completed" });
  await appt({ hour: 12, status: "no_show", by: f.receptionistId });
  await appt({ hour: 13, status: "cancelled" });
  await appt({ hour: 14, status: "rescheduled" });
  await appt({ hour: 15, daysAgo: 2 });
  // Outside a 7-day range.
  await appt({ hour: 10, daysAgo: 10, status: "completed" });

  const r = await getInsights(db, DESK(), "receptionist", f.clinicId, TZ, { days: 7 });
  assert.deepEqual(r.totals, { booked: 1, completed: 3, no_show: 1, cancelled: 1, rescheduled: 1 });
  assert.equal(r.noShowRate, 0.25);
  // created_at is now() for every row, the out-of-range one included.
  assert.deepEqual(r.sources, { agent: 6, staff: 2 });
  assert.equal(r.to, localDay(new Date()));
  // Cancelled and rescheduled rows took no slot: 4 on the book today, 1 two days ago.
  assert.equal(r.daily.at(-1)!.count, 4);
  assert.equal(r.daily.at(-3)!.count, 1);
  assert.equal(r.hourly[0].hour, OPEN_HOUR);
  assert.equal(r.hourly.at(-1)!.hour, CLOSE_HOUR - 1);
  assert.equal(r.hourly.find(h => h.hour === 13)!.count, 0);
  assert.equal(r.hourly.find(h => h.hour === 15)!.count, 1);
  assert.deepEqual(r.doctors.map(d => [d.name, d.total, d.completed, d.noShow, d.noShowRate]),
    [["Dr. Rao", 5, 3, 1, 0.25]]);
  assert.equal(r.newPatients, 2);

  const wide = await getInsights(db, DESK(), "receptionist", f.clinicId, TZ, { days: 30 });
  assert.equal(wide.totals.completed, 4);
});

test("the daily series is zero-filled to exactly the range", async () => {
  for (const days of [7, 30, 90] as const) {
    const r = await getInsights(db, DESK(), "receptionist", f.clinicId, TZ, { days });
    assert.equal(r.daily.length, days);
    assert.ok(r.daily.every(d => d.count === 0));
    assert.equal(r.daily[0].day, r.from);
    assert.equal(r.daily.at(-1)!.day, r.to);
    assert.equal(r.noShowRate, null);
  }
  await assert.rejects(
    getInsights(db, DESK(), "receptionist", f.clinicId, TZ, { days: 14 as unknown as 7 }),
    (e) => e instanceof DeskError);
});

test("a doctor's scope excludes another doctor's appointments and patients", async () => {
  const [d2] = await db<{ id: string }[]>`
    insert into doctors (clinic_id, name, specialty, default_slot_minutes)
    values (${f.clinicId}, 'Dr Second', 'ENT', 30) returning id`;
  await appt({ hour: 10, status: "completed" });
  await appt({ hour: 11, status: "no_show", doctorId: d2.id, patientId: f.otherPatientId });

  const mine = await getInsights(db, { kind: "staff", id: f.doctorUserId }, "doctor",
    f.clinicId, TZ, { days: 7 }, f.doctorId);
  assert.equal(mine.totals.completed, 1);
  assert.equal(mine.totals.no_show, 0);
  assert.equal(mine.noShowRate, 0);
  assert.deepEqual(mine.doctors.map(d => d.name), ["Dr. Rao"]);
  assert.equal(mine.newPatients, 1);

  const all = await getInsights(db, DESK(), "receptionist", f.clinicId, TZ, { days: 7 });
  // Sorted here: the SQL order by name depends on the database collation.
  assert.deepEqual(all.doctors.map(d => `${d.name}:${d.total}`).sort(), ["Dr Second:1", "Dr. Rao:1"]);
  assert.equal(all.noShowRate, 0.5);
});

test("another clinic's rows are never counted", async () => {
  await appt({ hour: 10, status: "no_show", clinicId: f.otherClinicId,
               doctorId: f.otherDoctorId, patientId: f.otherClinicPatientId });
  const r = await getInsights(db, DESK(), "receptionist", f.clinicId, TZ, { days: 7 });
  assert.equal(Object.values(r.totals).reduce((a, b) => a + b, 0), 0);
  assert.deepEqual(r.sources, { agent: 0, staff: 0 });
  assert.deepEqual(r.doctors.map(d => d.name), ["Dr. Rao"]);
  assert.equal(r.newPatients, 2);
  // Even naming the rival's doctor finds nothing.
  const sneaky = await getInsights(db, DESK(), "receptionist", f.clinicId, TZ, { days: 7 }, f.otherDoctorId);
  assert.equal(sneaky.totals.no_show, 0);
  assert.deepEqual(sneaky.doctors, []);
});

test("a soft-deleted patient's appointments and registration are left out", async () => {
  await appt({ hour: 10, status: "completed", patientId: f.otherPatientId });
  await db`update patients set deleted_at = now() where id = ${f.otherPatientId}`;
  const r = await getInsights(db, DESK(), "receptionist", f.clinicId, TZ, { days: 7 });
  assert.equal(r.totals.completed, 0);
  assert.equal(r.newPatients, 1);
});

test("the AI agent is refused; staff reads are audited", async () => {
  // The agent holds appointments:read (it books), so the refusal is the staff-only guard.
  await assert.rejects(getInsights(db, { kind: "agent" }, "agent", f.clinicId, TZ, { days: 7 }),
    (e) => e instanceof DeskError);
  await getInsights(db, DESK(), "receptionist", f.clinicId, TZ, { days: 7 });
  const rows = await db`select actor from audit_log where action = 'read_insights' and target_table = 'appointments'`;
  assert.deepEqual(rows.map(r => r.actor), [f.receptionistId]);
});
