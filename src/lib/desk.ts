/**
 * Front-desk actions: register a walk-in, mark an arrival, record the outcome.
 *
 * Arrival is `arrived_at` on a still-`booked` appointment; the outcome moves it
 * to `completed` or `no_show`, after which it is no longer the desk's to change.
 */
import type { Db } from "./db";
import { audit, type Actor } from "./audit";
import { recordConsent } from "./consent";
import { requirePermission, type Role } from "./rbac";
import { cancelReminders } from "./reminders";
import { normalisePhone, VoiceInputError } from "./voice";

export class DeskError extends Error {
  constructor(message: string) { super(message); this.name = "DeskError"; }
}

export async function registerPatient(
  db: Db, actor: Actor, role: Role, clinicId: string,
  input: { name: string; phone: string; consent: boolean },
): Promise<{ id: string; existing: boolean }> {
  requirePermission(role, "patients:write");
  let phone: string;
  try { phone = normalisePhone(input.phone); } catch (e) {
    if (e instanceof VoiceInputError) throw new DeskError("invalid phone number");
    throw e;
  }

  // A known number is the same person: open their record, change nothing.
  const [found] = await db<{ id: string }[]>`
    select id from patients where clinic_id = ${clinicId} and phone = ${phone}`;
  if (found) {
    await audit(db, actor, "read_patient", "patients", found.id);
    return { id: found.id, existing: true };
  }

  const name = input.name.trim();
  if (!name) throw new DeskError("name required");
  if (!input.consent) throw new DeskError("consent required");

  // ponytail: two desks registering the same new number at once — one hits the
  // (clinic_id, phone) unique constraint and errors; retry opens the record.
  const [row] = await db<{ id: string }[]>`
    insert into patients (clinic_id, name, phone)
    values (${clinicId}, ${name}, ${phone}) returning id`;
  await audit(db, actor, "register_patient", "patients", row.id);
  await recordConsent(db, actor, row.id, "granted", "desk");
  return { id: row.id, existing: false };
}

/** The appointment, if it is still `booked`, in this clinic and (for a doctor) his. */
async function activeAppointment(
  db: Db, clinicId: string, appointmentId: string, doctorId?: string | null,
) {
  const [a] = await db<{ starts_at: Date; doctor_id: string }[]>`
    select starts_at, doctor_id from appointments
     where id = ${appointmentId} and clinic_id = ${clinicId} and status = 'booked'`;
  if (!a) throw new DeskError("not_active");
  if (doctorId && a.doctor_id !== doctorId) throw new DeskError("not your appointment");
  return a;
}

export async function markArrived(
  db: Db, actor: Actor, role: Role, clinicId: string, appointmentId: string,
): Promise<void> {
  requirePermission(role, "appointments:write");
  await activeAppointment(db, clinicId, appointmentId);
  await db`update appointments set arrived_at = now(), updated_at = now()
            where id = ${appointmentId}`;
  await audit(db, actor, "mark_arrived", "appointments", appointmentId);
}

export async function setOutcome(
  db: Db, actor: Actor, role: Role, clinicId: string, appointmentId: string,
  outcome: "completed" | "no_show", doctorId?: string | null,
): Promise<void> {
  requirePermission(role, "appointments:write");
  const a = await activeAppointment(db, clinicId, appointmentId, doctorId);
  // A patient seen early is completed; one who has not missed anything yet is not a no-show.
  if (outcome === "no_show" && a.starts_at.getTime() > Date.now()) {
    throw new DeskError("not started yet");
  }
  await db`update appointments set status = ${outcome}::appointment_status, updated_at = now()
            where id = ${appointmentId}`;
  await cancelReminders(db, appointmentId);
  await audit(db, actor, `appointment_${outcome}`, "appointments", appointmentId);
}
