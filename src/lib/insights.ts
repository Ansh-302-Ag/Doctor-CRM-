/**
 * Clinic insights: how busy the clinic was, how many patients turned up, and
 * how much of the booking the AI assistant took off the desk.
 *
 * Operational counts only — no patient names, no reasons, nothing clinical —
 * clinic-scoped, doctor-scoped like the screens it summarises, and audited.
 */
import type { Db } from "./db";
import { audit, type Actor } from "./audit";
import { requirePermission, type Role } from "./rbac";
import { DeskError } from "./desk";
import { ownedBy } from "./patients";
import { OPEN_HOUR, CLOSE_HOUR } from "./booking";

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];

const STATUSES = ["booked", "completed", "no_show", "cancelled", "rescheduled"] as const;
type Status = (typeof STATUSES)[number];

/** Cancelled and rescheduled rows never took up a slot (a reschedule leaves a
 *  new 'booked' row behind), so the day, hour and doctor counts leave them out. */
const onBook = (s: string) => s === "booked" || s === "completed" || s === "no_show";

/** no_show / (completed + no_show): of the visits whose outcome is known, how
 *  many the patient missed. Null when no outcome has been recorded yet. */
export const noShowRate = (completed: number, noShow: number) =>
  completed + noShow === 0 ? null : noShow / (completed + noShow);

export type Insights = {
  from: string; to: string; days: RangeDays;   // inclusive local dates
  totals: Record<Status, number>;
  noShowRate: number | null;
  sources: { agent: number; staff: number };  // appointments created in the range
  daily: { day: string; count: number }[];    // every day in the range, zeros included
  hourly: { hour: number; count: number }[];  // clinic hours, plus any hour that had bookings
  doctors: { id: string; name: string; total: number; completed: number; noShow: number; noShowRate: number | null }[];
  newPatients: number;
};

const localDay = (at: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(at);
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The last `days` local days ending today, inclusive. `doctorId` limits to one
 *  doctor — the doctor himself, or the desk's filter. */
export async function getInsights(
  db: Db, actor: Actor, role: Role, clinicId: string, timezone: string,
  opts: { days: RangeDays }, doctorId?: string | null,
): Promise<Insights> {
  requirePermission(role, "appointments:read");
  // The agent holds appointments:read to book, but a clinic-wide report is a staff screen.
  if (actor.kind !== "staff") throw new DeskError("staff only");
  if (!RANGES.includes(opts.days)) throw new DeskError("unsupported range");

  const to = localDay(new Date(), timezone);
  const from = addDays(to, -(opts.days - 1));
  // Half-open on the raw column, as on the calendar, so the starts_at index applies.
  const inRange = (col: "a.starts_at" | "a.created_at" | "p.created_at") => db`
        ${db(col)} >= (${from} || ' 00:00')::timestamp at time zone ${timezone}
    and ${db(col)} <  ((${to} || ' 00:00')::timestamp + interval '1 day') at time zone ${timezone}`;
  const scope = doctorId ? db`and a.doctor_id = ${doctorId}` : db``;

  const [grid, [src], doctors, [pat]] = await Promise.all([
    db<{ day: string; hour: number; status: Status; doctor_id: string; n: number }[]>`
      select to_char(a.starts_at at time zone ${timezone}, 'YYYY-MM-DD') as day,
             extract(hour from a.starts_at at time zone ${timezone})::int as hour,
             a.status, a.doctor_id, count(*)::int as n
        from appointments a
        join patients p on p.id = a.patient_id
       where a.clinic_id = ${clinicId} and p.deleted_at is null ${scope}
         and ${inRange("a.starts_at")}
       group by 1, 2, 3, 4`,
    db<{ agent: number; staff: number }[]>`
      select count(*) filter (where a.created_by = 'agent')::int as agent,
             count(*) filter (where a.created_by <> 'agent')::int as staff
        from appointments a
        join patients p on p.id = a.patient_id
       where a.clinic_id = ${clinicId} and p.deleted_at is null ${scope}
         and ${inRange("a.created_at")}`,
    db<{ id: string; name: string }[]>`
      select id, name from doctors
       where clinic_id = ${clinicId} ${doctorId ? db`and id = ${doctorId}` : db``}
       order by name`,
    db<{ n: number }[]>`
      select count(*)::int as n from patients p
       where p.clinic_id = ${clinicId} and p.deleted_at is null
         ${ownedBy(db, doctorId)}
         and ${inRange("p.created_at")}`,
    audit(db, actor, "read_insights", "appointments", null),
  ]);

  const totals = Object.fromEntries(STATUSES.map(s => [s, 0])) as Record<Status, number>;
  const perDay = new Map<string, number>();
  const perHour = new Map<number, number>();
  const perDoctor = new Map<string, { total: number; completed: number; noShow: number }>();
  for (const r of grid) {
    totals[r.status] += r.n;
    if (!onBook(r.status)) continue;
    perDay.set(r.day, (perDay.get(r.day) ?? 0) + r.n);
    perHour.set(r.hour, (perHour.get(r.hour) ?? 0) + r.n);
    const d = perDoctor.get(r.doctor_id) ?? { total: 0, completed: 0, noShow: 0 };
    d.total += r.n;
    if (r.status === "completed") d.completed += r.n;
    if (r.status === "no_show") d.noShow += r.n;
    perDoctor.set(r.doctor_id, d);
  }

  const hours = [...perHour.keys()];
  const first = Math.min(OPEN_HOUR, ...hours);
  const last = Math.max(CLOSE_HOUR - 1, ...hours);

  return {
    from, to, days: opts.days, totals,
    noShowRate: noShowRate(totals.completed, totals.no_show),
    sources: src,
    daily: Array.from({ length: opts.days }, (_, i) => {
      const day = addDays(from, i);
      return { day, count: perDay.get(day) ?? 0 };
    }),
    hourly: Array.from({ length: last - first + 1 }, (_, i) =>
      ({ hour: first + i, count: perHour.get(first + i) ?? 0 })),
    doctors: doctors.map(d => {
      const c = perDoctor.get(d.id) ?? { total: 0, completed: 0, noShow: 0 };
      return { id: d.id, name: d.name, ...c, noShowRate: noShowRate(c.completed, c.noShow) };
    }),
    newPatients: pat.n,
  };
}
