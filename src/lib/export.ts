/**
 * CSV export of patients and of appointments in a date range.
 *
 * Staff leave with this data on their own machine, so every export is audited,
 * doctor-scoped like the screens it mirrors, and carries no message bodies or
 * prescription content — only what the list screens already show.
 */
import type { Db } from "./db";
import { audit, type Actor } from "./audit";
import { requirePermission, type Role } from "./rbac";
import { DeskError } from "./desk";
import { ownedBy } from "./patients";

const MAX_DAYS = 92;

/** RFC 4180: comma separated, CRLF rows, quote what needs it. A cell starting
 *  with = + - @ (or tab/CR) gets a leading apostrophe so a spreadsheet shows it
 *  as text instead of running it as a formula. Phones start with "+", so they
 *  are prefixed too — intended: Excel would otherwise read +91… as a formula. */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns, ...rows.map(r => columns.map(c => r[c]))]
    .map(line => line.map(cell).join(",")).join("\r\n") + "\r\n";
}

const day = (at: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(at);
const hm = (at: Date, tz: string) => new Intl.DateTimeFormat("en-GB", {
  timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);

export async function exportPatients(
  db: Db, actor: Actor, role: Role, clinicId: string, timezone: string,
  doctorId?: string | null,
): Promise<string> {
  requirePermission(role, "patients:read");
  const [rows] = await Promise.all([
    db<{
      name: string | null; phone: string; consent_status: string; created_at: Date;
      next_appointment: Date | null; active_prescriptions: number;
    }[]>`
      select p.name, p.phone, p.consent_status, p.created_at,
             (select min(a.starts_at) from appointments a
               where a.patient_id = p.id and a.status = 'booked' and a.starts_at > now()
             ) as next_appointment,
             (select count(*) from prescriptions r
               where r.patient_id = p.id and r.status = 'active'
             )::int as active_prescriptions
        from patients p
       where p.clinic_id = ${clinicId} and p.deleted_at is null
         ${ownedBy(db, doctorId)}
       order by p.name nulls last, p.created_at`,
    audit(db, actor, "export_patients", "patients", null),
  ]);
  return toCsv(rows.map(r => ({
    ...r,
    registered_on: day(r.created_at, timezone),
    next_appointment: r.next_appointment
      ? `${day(r.next_appointment, timezone)} ${hm(r.next_appointment, timezone)}` : "",
  })), ["name", "phone", "consent_status", "registered_on", "next_appointment", "active_prescriptions"]);
}

const isDay = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** from/to are inclusive local dates. `doctorId` limits to one doctor's
 *  appointments — the doctor himself, or the desk's calendar filter. */
export async function exportAppointments(
  db: Db, actor: Actor, role: Role, clinicId: string, timezone: string,
  from: string, to: string, doctorId?: string | null,
): Promise<string> {
  requirePermission(role, "appointments:read");
  requirePermission(role, "patients:read");
  if (!isDay(from) || !isDay(to)) throw new DeskError("Dates must be YYYY-MM-DD.");
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (span < 0) throw new DeskError("The end date is before the start date.");
  if (span + 1 > MAX_DAYS) throw new DeskError(`Export at most ${MAX_DAYS} days at a time.`);

  const [rows] = await Promise.all([
    db<{
      starts_at: Date; doctor_name: string; patient_name: string | null; phone: string;
      status: string; arrived_at: Date | null; reason_text: string | null; booked_by: string | null;
    }[]>`
      select a.starts_at, d.name as doctor_name, p.name as patient_name, p.phone,
             a.status, a.arrived_at, a.reason_text,
             case when a.created_by = 'agent' then 'AI assistant' else u.name end as booked_by
        from appointments a
        join doctors d  on d.id = a.doctor_id
        join patients p on p.id = a.patient_id
        left join staff_users u on u.id::text = a.created_by
       where a.clinic_id = ${clinicId} and p.deleted_at is null
         ${doctorId ? db`and a.doctor_id = ${doctorId}` : db``}
         and a.starts_at >= (${from} || ' 00:00')::timestamp at time zone ${timezone}
         and a.starts_at <  ((${to} || ' 00:00')::timestamp + interval '1 day') at time zone ${timezone}
       order by a.starts_at`,
    audit(db, actor, "export_appointments", "appointments", null),
  ]);
  return toCsv(rows.map(r => ({
    date: day(r.starts_at, timezone), time: hm(r.starts_at, timezone),
    doctor: r.doctor_name, patient: r.patient_name, phone: r.phone, status: r.status,
    arrived: r.arrived_at ? "yes" : "", reason: r.reason_text, booked_by: r.booked_by,
  })), ["date", "time", "doctor", "patient", "phone", "status", "arrived", "reason", "booked_by"]);
}

/** The download itself. The BOM makes Excel read the file as UTF-8, so Hindi
 *  and other Indic names are not mangled. */
export const csvResponse = (csv: string, filename: string) =>
  new Response("﻿" + csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
