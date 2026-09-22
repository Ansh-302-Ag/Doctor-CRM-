import type { Db } from "./db";
import { audit, actorId, type Actor } from "./audit";
import { assertConsent } from "./consent";
import { requirePermission, type Role } from "./rbac";
import { scheduleAppointmentReminder, cancelReminders } from "./reminders";

export type Slot = { startsAt: Date; endsAt: Date };

export type BookingErrorCode =
  | "slot_taken" | "slot_in_past" | "outside_hours"
  | "not_your_appointment" | "unknown_appointment" | "not_open";

export class BookingError extends Error {
  constructor(public code: BookingErrorCode, message: string) {
    super(message);
    this.name = "BookingError";
  }
}

/**
 * Clinic hours as a half-open local-time range, and the days it opens.
 * ponytail: one schedule shared by every doctor. Move to a per-doctor availability
 * table the first time a real clinic has doctors with different hours.
 */
export const OPEN_HOUR = 9;
export const CLOSE_HOUR = 18;
export const OPEN_DAYS = new Set(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);

/**
 * Intl.DateTimeFormat falls back to the SERVER's zone when `timeZone` is
 * undefined, so a clinic row read without its timezone would render and compare
 * every time in whatever zone the box happens to run in — silently, hours out,
 * with nothing failing. Refuse instead. A default here would be worse than the
 * bug: one clinic's hours hardcoded into every clinic's schedule.
 */
export function requireTimezone(timezone: string | null | undefined): string {
  if (!timezone) throw new Error("clinic timezone is missing");
  return timezone;
}

const partsIn = (at: Date, timezone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: requireTimezone(timezone), weekday: "short", hour: "2-digit", hour12: false,
  }).formatToParts(at);

const localPart = (at: Date, tz: string, type: "weekday" | "hour") =>
  partsIn(at, tz).find(p => p.type === type)!.value;

async function doctorContext(db: Db, doctorId: string) {
  const [d] = await db<{ clinic_id: string; default_slot_minutes: number; timezone: string }[]>`
    select d.clinic_id, d.default_slot_minutes, c.timezone
      from doctors d join clinics c on c.id = d.clinic_id
     where d.id = ${doctorId}
  `;
  if (!d) throw new Error(`unknown doctor ${doctorId}`);
  return d;
}

/**
 * Open slots for one doctor on one local calendar day.
 * `day` is 'YYYY-MM-DD' as the clinic reckons it.
 */
export async function checkAvailability(
  db: Db, doctorId: string, day: string, now = new Date(),
): Promise<Slot[]> {
  const doctor = await doctorContext(db, doctorId);

  // Let Postgres resolve local time to instants — it already knows the DST rules.
  const pad = (h: number) => String(h).padStart(2, "0");
  const [bounds] = await db<{ open: Date; close: Date }[]>`
    select (${`${day} ${pad(OPEN_HOUR)}:00:00`}::timestamp at time zone ${doctor.timezone}) as open,
           (${`${day} ${pad(CLOSE_HOUR)}:00:00`}::timestamp at time zone ${doctor.timezone}) as close
  `;
  if (!OPEN_DAYS.has(localPart(bounds.open, doctor.timezone, "weekday"))) return [];

  const taken = await db<{ starts_at: Date; ends_at: Date }[]>`
    select starts_at, ends_at from appointments
     where doctor_id = ${doctorId} and status = 'booked'
       and starts_at < ${bounds.close} and ends_at > ${bounds.open}
  `;

  const stepMs = doctor.default_slot_minutes * 60_000;
  const open: Slot[] = [];
  for (let t = bounds.open.getTime(); t + stepMs <= bounds.close.getTime(); t += stepMs) {
    const startsAt = new Date(t), endsAt = new Date(t + stepMs);
    if (startsAt <= now) continue;
    if (taken.some(a => a.starts_at < endsAt && a.ends_at > startsAt)) continue;
    open.push({ startsAt, endsAt });
  }
  return open;
}

export async function bookAppointment(
  db: Db, actor: Actor, role: Role,
  input: { patientId: string; doctorId: string; startsAt: Date; reasonText?: string },
  now = new Date(),
): Promise<{ id: string; startsAt: Date; endsAt: Date }> {
  requirePermission(role, "appointments:write");
  await assertConsent(db, input.patientId);
  if (input.startsAt <= now) {
    throw new BookingError("slot_in_past", "that time has already passed");
  }

  const doctor = await doctorContext(db, input.doctorId);
  const endsAt = new Date(input.startsAt.getTime() + doctor.default_slot_minutes * 60_000);
  const startHour = Number(localPart(input.startsAt, doctor.timezone, "hour"));
  // Check the end too: a 17:45 start with a 30-minute slot runs past closing.
  const endsAfterClose =
    Number(localPart(new Date(endsAt.getTime() - 1), doctor.timezone, "hour")) >= CLOSE_HOUR;
  if (startHour < OPEN_HOUR || startHour >= CLOSE_HOUR || endsAfterClose) {
    throw new BookingError("outside_hours",
      `the clinic books between ${OPEN_HOUR}:00 and ${CLOSE_HOUR}:00`);
  }
  if (!OPEN_DAYS.has(localPart(input.startsAt, doctor.timezone, "weekday"))) {
    throw new BookingError("not_open", "the clinic is closed that day");
  }

  try {
    const [row] = await db<{ id: string; starts_at: Date; ends_at: Date }[]>`
      insert into appointments
        (clinic_id, doctor_id, patient_id, starts_at, ends_at, reason_text, created_by)
      values
        (${doctor.clinic_id}, ${input.doctorId}, ${input.patientId},
         ${input.startsAt}, ${endsAt}, ${input.reasonText ?? null}, ${actorId(actor)})
      returning id, starts_at, ends_at
    `;
    await audit(db, actor, "book_appointment", "appointments", row.id);
    await scheduleAppointmentReminder(db, row.id, input.patientId, row.starts_at);
    return { id: row.id, startsAt: row.starts_at, endsAt: row.ends_at };
  } catch (e) {
    // 23P01 = exclusion_violation: the database refused a double-booking (docs/08).
    if ((e as { code?: string }).code === "23P01") {
      throw new BookingError("slot_taken", "that slot was just taken");
    }
    throw e;
  }
}

export async function rescheduleAppointment(
  db: Db, actor: Actor, role: Role,
  input: { appointmentId: string; patientId: string; startsAt: Date },
  now = new Date(),
) {
  requirePermission(role, "appointments:write");
  const appt = await ownedAppointment(db, input.appointmentId, input.patientId);

  // Take the new slot BEFORE releasing the old one. If the new slot is gone,
  // this throws and the patient still has their original appointment — even
  // when the caller catches the error and re-offers instead of rolling back.
  // Cost of this ordering: moving to a slot that overlaps the appointment's own
  // current time is refused as 'slot_taken'. That is a no-op move anyway.
  const booked = await bookAppointment(db, actor, role, {
    patientId: input.patientId,
    doctorId: appt.doctor_id,
    startsAt: input.startsAt,
    reasonText: appt.reason_text ?? undefined,
  }, now);
  await db`update appointments set status = 'rescheduled', updated_at = now()
            where id = ${input.appointmentId}`;

  await cancelReminders(db, input.appointmentId);
  await audit(db, actor, "reschedule_appointment", "appointments", input.appointmentId);
  return booked;
}

export async function cancelAppointment(
  db: Db, actor: Actor, role: Role,
  input: { appointmentId: string; patientId: string },
) {
  requirePermission(role, "appointments:write");
  await ownedAppointment(db, input.appointmentId, input.patientId);
  await db`update appointments set status = 'cancelled', updated_at = now()
            where id = ${input.appointmentId}`;
  await cancelReminders(db, input.appointmentId);
  await audit(db, actor, "cancel_appointment", "appointments", input.appointmentId);
}

export async function getUpcomingAppointments(
  db: Db, actor: Actor, role: Role, patientId: string,
) {
  requirePermission(role, "appointments:read");
  const rows = await db<{ id: string; starts_at: Date; doctor_name: string }[]>`
    select a.id, a.starts_at, d.name as doctor_name
      from appointments a join doctors d on d.id = a.doctor_id
     where a.patient_id = ${patientId} and a.status = 'booked' and a.starts_at > now()
     order by a.starts_at
  `;
  await audit(db, actor, "read_appointments", "patients", patientId);
  return rows;
}

async function ownedAppointment(db: Db, appointmentId: string, patientId: string) {
  const [a] = await db<{
    doctor_id: string; patient_id: string; reason_text: string | null; status: string;
  }[]>`select doctor_id, patient_id, reason_text, status
         from appointments where id = ${appointmentId}`;
  if (!a) throw new BookingError("unknown_appointment", "no such appointment");
  if (a.patient_id !== patientId) {
    throw new BookingError("not_your_appointment", "that appointment belongs to someone else");
  }
  return a;
}
