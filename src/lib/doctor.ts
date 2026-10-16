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
 *    clinic the record. The message carries NO prescription content — Meta's
 *    Business Messaging Policy forbids health information on WhatsApp — only a
 *    secure link to the record, behind a one-time code (record-links.ts).
 */
import type { Db, Pool } from "./db";
import { audit, type Actor } from "./audit";
import { requirePermission, type Role } from "./rbac";
import { patientScope, getPatient } from "./patients";
import { createPrescription, InvalidPrescription, type PrescriptionInput } from "./prescriptions";
import { inWindow, sendMessage, sendTemplate } from "./channel";
import { renderTemplate } from "./templates";
import { createRecordLink } from "./record-links";

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
  /** Why it was not delivered, for the doctor's screen
   *  (`consent_withdrawn`: "patient has withdrawn consent — not messaged"). */
  reason?: "outside_window" | "send_failed" | "consent_withdrawn";
  /** Outside the window: whether the `prescription_ready` template (with the link) went out. */
  nudged?: boolean;
};

/** One medicine as the doctor typed it. */
export type RxItem = {
  drugName: string; dosage: string; durationDays?: number | null; notes?: string | null;
};

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
 *
 * What goes out is a content-free note with a secure link (record-links.ts) —
 * never the drug, dose, duration or notes. Inside the 24-hour window it is
 * free-form text; outside, the same words as the `prescription_ready` template.
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

  let open = false;
  try {
    const [row] = await db<{
      phone: string; clinic_name: string; doctor_name: string; consent_status: string;
    }[]>`
      select p.phone, c.name as clinic_name, d.name as doctor_name, p.consent_status
        from patients p
        join clinics c on c.id = p.clinic_id
        join doctors d on d.id = ${doctorId}
       where p.id = ${patientId}`;
    // Withdrawn consent means no more messages (docs/02) — and no link either.
    if (row.consent_status === "withdrawn") {
      await auditAll("prescription_message_skipped");
      return { delivered: false, reason: "consent_withdrawn", nudged: false };
    }
    open = await inWindow(db, patientId, now);
    const { url } = await createRecordLink(db, patientId, now);
    const note = renderTemplate("prescription_ready", {
      clinic_name: row.clinic_name, doctor_name: row.doctor_name, link: url,
    });

    if (open) {
      // The channel reports delivery rather than throwing when it is not
      // configured at all. Telling the doctor his patient has it when nothing
      // left the building would be the worst kind of quiet failure.
      const { delivered } = await send({ to: row.phone, text: note.preview });
      await auditAll(delivered ? "prescription_message_sent" : "prescription_message_failed");
      return delivered ? { delivered: true }
                       : { delivered: false, reason: "send_failed", nudged: false };
    }

    const { delivered } = await sendT(
      { to: row.phone, name: note.name, parameters: note.parameters });
    await auditAll(delivered ? "prescription_message_deferred" : "prescription_message_failed");
    return { delivered: false, reason: "outside_window", nudged: delivered };
  } catch (e) {
    // The record stands. The doctor is told on screen, and the audit trail says
    // the patient was not reached — silence here would be the real harm.
    // channel.ts errors carry only Meta's status and code, never message text.
    console.error("prescription message failed", (e as Error).message);
    await auditAll("prescription_message_failed").catch(() => {});
    return { delivered: false, reason: open ? "send_failed" : "outside_window", nudged: false };
  }
}
