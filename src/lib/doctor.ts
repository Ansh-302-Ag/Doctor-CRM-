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
import type { Db, Pool } from "./db";
import { audit, type Actor } from "./audit";
import { requirePermission, type Role } from "./rbac";
import { patientScope, getPatient } from "./patients";
import { createPrescription, InvalidPrescription, type PrescriptionInput } from "./prescriptions";
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

/** One medicine as the doctor typed it. */
export type RxItem = {
  drugName: string; dosage: string; durationDays?: number | null; notes?: string | null;
};

/**
 * The message the patient gets. Every clinical word in it is the doctor's own,
 * copied out of the record unchanged; the only sentences this system adds say
 * who wrote it, when, and where to ask questions (docs/01).
 */
export function prescriptionMessage(p: {
  clinicName: string; clinicPhone: string | null; doctorName: string;
  at: Date; timezone: string;
} & RxItem): string {
  return prescriptionsMessage({ ...p, items: [p] });
}

/** Several medicines from one sitting, in one message: the same header and
 *  footer, each medicine exactly as typed, a blank line between them. For one
 *  medicine this is prescriptionMessage's text, character for character. */
export function prescriptionsMessage(p: {
  clinicName: string; clinicPhone: string | null; doctorName: string;
  at: Date; timezone: string; items: RxItem[];
}): string {
  return [
    `${p.clinicName}`,
    `Prescription recorded by ${p.doctorName} on ${when(p.at, p.timezone)}:`,
    ...p.items.flatMap(i => [
      "",
      i.drugName,
      `Dosage: ${i.dosage}`,
      ...(i.durationDays ? [`Duration: ${i.durationDays} day${i.durationDays === 1 ? "" : "s"}`] : []),
      ...(i.notes ? [`Notes: ${i.notes}`] : []),
    ]),
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
  requirePermission(staff.role, "prescriptions:write");
  const actor = { kind: "staff" as const, id: staff.id };
  const doctorId = await prescriber(db, staff, input);
  const { id } = await createPrescription(db, actor, staff.role, { ...input, doctorId });
  const delivery = await deliver(db, actor, input.patientId, doctorId, [id], deps);
  return { id, delivery };
}

/** At most this many medicines in one sitting — a sanity bound on a form. */
export const MAX_ITEMS = 20;

/**
 * Record every medicine from one sitting and send the patient ONE message
 * listing them all. Same attribution and scope rules as prescribeAndNotify.
 *
 * The rows are all-or-nothing: a bad second medicine means the first is not
 * saved either, so the doctor never has to work out which half went in. The
 * send happens only after the commit, and never throws.
 *
 * Takes a pool, not any Db: like voice.ts and merge.ts, it opens its own
 * transaction, and the send must wait until that has committed.
 */
export async function prescribeManyAndNotify(
  db: Pool, staff: StaffContext,
  input: { patientId: string; doctorId?: string; items: RxItem[] }, deps: Deps = {},
): Promise<{ ids: string[]; delivery: Delivery }> {
  requirePermission(staff.role, "prescriptions:write");
  if (input.items.length === 0) {
    throw new InvalidPrescription("items", "add at least one medicine");
  }
  if (input.items.length > MAX_ITEMS) {
    throw new InvalidPrescription("items", `at most ${MAX_ITEMS} medicines at once`);
  }
  const actor = { kind: "staff" as const, id: staff.id };
  const doctorId = await prescriber(db, staff, input);
  const many = input.items.length > 1;

  const ids = await db.begin(async tx => {
    const out: string[] = [];
    for (const [i, item] of input.items.entries()) {
      try {
        const { id } = await createPrescription(tx, actor, staff.role, {
          patientId: input.patientId, doctorId,
          drugName: item.drugName, dosage: item.dosage,
          durationDays: item.durationDays ?? undefined, notes: item.notes ?? undefined,
        });
        out.push(id);
      } catch (e) {
        // Say which one, so the doctor can find it in a list of several.
        if (many && e instanceof InvalidPrescription) {
          throw new InvalidPrescription(e.field, `Medicine ${i + 1}: ${e.message}`);
        }
        throw e;
      }
    }
    return out;
  });

  const delivery = await deliver(db, actor, input.patientId, doctorId, ids, deps);
  return { ids, delivery };
}

/** Who is prescribing, after the scope check. The doctor signs as himself;
 *  an admin must name one. The patient id comes off a form, so it is
 *  re-resolved under this staff member's own scope before anything is
 *  written (docs/08): for a doctor, one of his own patients, at his own
 *  clinic, not soft-deleted. */
async function prescriber(
  db: Db, staff: StaffContext, input: { patientId: string; doctorId?: string },
): Promise<string> {
  const doctorId = staff.role === "doctor" ? staff.doctorId : input.doctorId;
  if (!doctorId) throw new NotYourPatient();
  const patient = await getPatient(
    db, { kind: "staff", id: staff.id }, staff.role, staff.clinicId, input.patientId,
    patientScope(staff));
  if (!patient) throw new NotYourPatient();
  return doctorId;
}

/**
 * The one path every prescription message takes, one medicine or several:
 * one send per sitting. Audited per prescription with the same actions as
 * ever, so "did prescription X reach the patient?" stays a single lookup.
 */
async function deliver(
  db: Db, actor: Actor, patientId: string, doctorId: string, ids: string[], deps: Deps,
): Promise<Delivery> {
  const send = deps.send ?? sendMessage;
  const sendT = deps.sendT ?? sendTemplate;
  const now = deps.now ?? new Date();
  const auditAll = async (action: string) => {
    for (const id of ids) await audit(db, actor, action, "prescriptions", id);
  };

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
     where p.id = ${patientId}`;

  const open = row.last_inbound !== null &&
               now.getTime() - row.last_inbound.getTime() < WINDOW_MS;
  try {
    if (open) {
      const full = await db<{
        id: string; drug_name: string; dosage: string; duration_days: number | null;
        notes: string | null; created_at: Date; timezone: string;
      }[]>`
        select r.id, r.drug_name, r.dosage, r.duration_days, r.notes, r.created_at, c.timezone
          from prescriptions r
          join patients p on p.id = r.patient_id
          join clinics  c on c.id = p.clinic_id
         where r.id in ${db(ids)}`;
      // In the order the doctor wrote them.
      full.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      // Read back out of the record rather than reusing the form values: what
      // the patient is told is then, by construction, what was stored.
      // The channel reports delivery rather than throwing when it is not
      // configured at all. Telling the doctor his patient has it when nothing
      // left the building would be the worst kind of quiet failure.
      const { delivered } = await send({
        to: row.phone,
        text: prescriptionsMessage({
          clinicName: row.clinic_name, clinicPhone: row.clinic_phone,
          doctorName: row.doctor_name, at: full[0].created_at, timezone: full[0].timezone,
          items: full.map(r => ({
            drugName: r.drug_name, dosage: r.dosage, durationDays: r.duration_days, notes: r.notes,
          })),
        }),
      });
      await auditAll(delivered ? "prescription_message_sent" : "prescription_message_failed");
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
    const { delivered } = await sendT(
      { to: row.phone, name: nudge.name, parameters: nudge.parameters });
    await auditAll(delivered ? "prescription_message_deferred" : "prescription_message_failed");
    return { delivered: false, reason: "outside_window", nudged: delivered };
  } catch (e) {
    // The record stands. The doctor is told on screen, and the audit trail says
    // the patient was not reached — silence here would be the real harm.
    console.error("prescription message failed", (e as Error).message);
    await auditAll("prescription_message_failed").catch(() => {});
    return { delivered: false, reason: open ? "send_failed" : "outside_window", nudged: false };
  }
}
