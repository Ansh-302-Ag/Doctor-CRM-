/**
 * The doctor's own side of the CRM: his queue for the day, and recording a
 * prescription and getting it to the patient.
 *
 * Two rules shape this file.
 *
 * 1. A doctor acts on HIS OWN patients (docs/08). That is enforced in the
 *    queries here and in `patientScope` — an id in a URL proves nothing.
 * 2. The record is the point (docs/01). The prescription is stored first and
 *    the message goes out afterwards, so a WhatsApp failure can never cost the
 *    clinic the record. The message states what the doctor typed, verbatim,
 *    and adds no guidance of its own.
 */
import type { Db } from "./db";
import { audit, type Actor } from "./audit";
import type { Role } from "./rbac";
import { patientScope, getPatient } from "./patients";
import { createPrescription, type PrescriptionInput } from "./prescriptions";
import { sendMessage, sendTemplate } from "./channel";
import { renderTemplate } from "./templates";

/** The signed-in staff member, as `currentStaff()` returns him. */
export type StaffContext = {
  id: string; role: Role; clinicId: string; doctorId: string | null; timezone: string;
};

export type QueueEntry = {
  id: string; starts_at: Date; ends_at: Date; status: string;
  patient_id: string; patient_name: string | null; patient_phone: string;
  reason_text: string | null; arrived_at: Date | null;
};

/**
 * One doctor's day, in time order. Same half-open range as the clinic calendar
 * (src/app/(crm)/page.tsx), so a 23- or 25-hour DST day stays one day long and
 * the (doctor_id, starts_at) index still applies.
 */
export async function doctorQueue(
  db: Db, actor: Actor, clinicId: string, doctorId: string, day: string, timezone: string,
): Promise<QueueEntry[]> {
  const [rows] = await Promise.all([
    db<QueueEntry[]>`
      select a.id, a.starts_at, a.ends_at, a.status, a.reason_text, a.arrived_at,
             p.id as patient_id, p.name as patient_name, p.phone as patient_phone
        from appointments a
        join patients p on p.id = a.patient_id
       where a.doctor_id = ${doctorId} and a.clinic_id = ${clinicId}
         and p.deleted_at is null
         and a.status in ('booked','completed','no_show')
         and a.starts_at >= (${day} || ' 00:00')::timestamp at time zone ${timezone}
         and a.starts_at <  ((${day} || ' 00:00')::timestamp + interval '1 day')
                            at time zone ${timezone}
       order by a.starts_at`,
    audit(db, actor, "read_doctor_queue", "appointments", null),
  ]);
  return rows;
}

/** Who is next: the first still-booked appointment that has not started yet. */
export const nextInQueue = (rows: QueueEntry[], now = new Date()) =>
  rows.find(r => r.status === "booked" && r.starts_at > now) ?? null;

export class NotYourPatient extends Error {
  constructor() {
    super("that patient is not on your list at this clinic");
    this.name = "NotYourPatient";
  }
}

export type Delivery = {
  delivered: boolean;
  /** Why it was not delivered, for the doctor's screen. */
  reason?: "outside_window" | "send_failed";
  /** Whether the content-free "there is something to collect" template went out. */
  nudged?: boolean;
};

/** WhatsApp allows free-form text only within 24 hours of the patient's own
 *  last message (docs/10). A prescription can never go out as a template, so
 *  outside that window it cannot be sent at all. */
export const WINDOW_MS = 24 * 60 * 60 * 1000;

const when = (at: Date, timezone: string) => new Intl.DateTimeFormat("en-GB", {
  timeZone: timezone, weekday: "short", day: "numeric", month: "short", year: "numeric",
  hour: "numeric", minute: "2-digit", hour12: true,
}).format(at);

/**
 * The message the patient gets. Every clinical word in it is the doctor's own,
 * copied out of the record unchanged; the only sentences this system adds say
 * who wrote it, when, and where to ask questions (docs/01).
 */
export function prescriptionMessage(p: {
  clinicName: string; clinicPhone: string | null; doctorName: string;
  at: Date; timezone: string;
  drugName: string; dosage: string; durationDays?: number | null; notes?: string | null;
}): string {
  return [
    `${p.clinicName}`,
    `Prescription recorded by ${p.doctorName} on ${when(p.at, p.timezone)}:`,
    "",
    p.drugName,
    `Dosage: ${p.dosage}`,
    ...(p.durationDays ? [`Duration: ${p.durationDays} day${p.durationDays === 1 ? "" : "s"}`] : []),
    ...(p.notes ? [`Notes: ${p.notes}`] : []),
    "",
    "This is your record exactly as your doctor entered it. For any question about it, " +
    (p.clinicPhone ? `call the clinic on ${p.clinicPhone}.` : "call the clinic."),
  ].join("\n");
}

type Deps = { send?: typeof sendMessage; sendT?: typeof sendTemplate; now?: Date };

/**
 * Record a prescription and put it in the patient's hands.
 *
 * The doctor is the prescriber: when a doctor signs this, it is attributed to
 * him and the caller cannot say otherwise. An admin, who has no doctor row,
 * still has to name one.
 *
 * The write and the send are deliberately not one unit of work: the row is
 * committed before anything is sent, and no send failure is allowed to
 * propagate, so the record survives a dead WhatsApp every time.
 */
export async function prescribeAndNotify(
  db: Db, staff: StaffContext, input: PrescriptionInput, deps: Deps = {},
): Promise<{ id: string; delivery: Delivery }> {
  const send = deps.send ?? sendMessage;
  const sendT = deps.sendT ?? sendTemplate;
  const now = deps.now ?? new Date();
  const actor = { kind: "staff" as const, id: staff.id };

  const doctorId = staff.role === "doctor" ? staff.doctorId : input.doctorId;
  if (!doctorId) throw new NotYourPatient();

  // The patient id comes off a form. Re-resolve it under this staff member's
  // own scope before writing anything (docs/08): for a doctor that means one of
  // his own patients, at his own clinic, not soft-deleted.
  const patient = await getPatient(
    db, actor, staff.role, staff.clinicId, input.patientId, patientScope(staff));
  if (!patient) throw new NotYourPatient();

  const { id } = await createPrescription(db, actor, staff.role, { ...input, doctorId });

  const [row] = await db<{
    phone: string; clinic_name: string; clinic_phone: string | null;
    doctor_name: string; last_inbound: Date | null;
  }[]>`
    select p.phone, c.name as clinic_name, c.phone as clinic_phone, d.name as doctor_name,
           (select max(m.created_at)
              from messages m
              join conversations cv on cv.id = m.conversation_id
             where cv.patient_id = p.id and m.direction = 'inbound') as last_inbound
      from patients p
      join clinics c on c.id = p.clinic_id
      join doctors d on d.id = ${doctorId}
     where p.id = ${input.patientId}`;

  const delivery = await deliver(db, actor, id, row, now, { send, sendT });
  return { id, delivery };
}

async function deliver(
  db: Db, actor: Actor, prescriptionId: string,
  row: {
    phone: string; clinic_name: string; clinic_phone: string | null;
    doctor_name: string; last_inbound: Date | null;
  },
  now: Date, io: { send: typeof sendMessage; sendT: typeof sendTemplate },
): Promise<Delivery> {
  const open = row.last_inbound !== null &&
               now.getTime() - row.last_inbound.getTime() < WINDOW_MS;
  try {
    if (open) {
      const [full] = await db<{
        drug_name: string; dosage: string; duration_days: number | null;
        notes: string | null; created_at: Date; timezone: string;
      }[]>`
        select r.drug_name, r.dosage, r.duration_days, r.notes, r.created_at, c.timezone
          from prescriptions r
          join patients p on p.id = r.patient_id
          join clinics  c on c.id = p.clinic_id
         where r.id = ${prescriptionId}`;
      // Read back out of the record rather than reusing the form values: what
      // the patient is told is then, by construction, what was stored.
      // The channel reports delivery rather than throwing when it is not
      // configured at all. Telling the doctor his patient has it when nothing
      // left the building would be the worst kind of quiet failure.
      const { delivered } = await io.send({
        to: row.phone,
        text: prescriptionMessage({
          clinicName: row.clinic_name, clinicPhone: row.clinic_phone,
          doctorName: row.doctor_name, at: full.created_at, timezone: full.timezone,
          drugName: full.drug_name, dosage: full.dosage,
          durationDays: full.duration_days, notes: full.notes,
        }),
      });
      await audit(db, actor,
        delivered ? "prescription_message_sent" : "prescription_message_failed",
        "prescriptions", prescriptionId);
      return delivered ? { delivered: true }
                       : { delivered: false, reason: "send_failed", nudged: false };
    }

    // Outside the window the record itself cannot be sent, and stuffing a drug
    // name into a template is exactly what docs/01 forbids. So the patient gets
    // a content-free note that there is something to collect; their reply
    // reopens the window and the agent reads the record back verbatim.
    const nudge = renderTemplate("record_updated", {
      clinic_name: row.clinic_name, doctor_name: row.doctor_name,
    });
    const { delivered } = await io.sendT(
      { to: row.phone, name: nudge.name, parameters: nudge.parameters });
    await audit(db, actor,
      delivered ? "prescription_message_deferred" : "prescription_message_failed",
      "prescriptions", prescriptionId);
    return { delivered: false, reason: "outside_window", nudged: delivered };
  } catch (e) {
    // The record stands. The doctor is told on screen, and the audit trail says
    // the patient was not reached — silence here would be the real harm.
    console.error("prescription message failed", (e as Error).message);
    await audit(db, actor, "prescription_message_failed", "prescriptions", prescriptionId)
      .catch(() => {});
    return { delivered: false, reason: open ? "send_failed" : "outside_window", nudged: false };
  }
}
