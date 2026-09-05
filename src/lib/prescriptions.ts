/**
 * Prescription records. This module is the only thing that writes the table.
 *
 * A prescription here is a RECORD of what the doctor decided, never a
 * recommendation and never something the system reasons about (docs/01). It is
 * stored exactly as entered and read back verbatim.
 */
import type { Db } from "./db";
import { audit, type Actor } from "./audit";
import { requirePermission, type Role } from "./rbac";

export type PrescriptionInput = {
  patientId: string; doctorId: string; appointmentId?: string;
  drugName: string; dosage: string; durationDays?: number; notes?: string;
};

export type Prescription = {
  id: string; drug_name: string; dosage: string; duration_days: number | null;
  notes: string | null; status: "active" | "completed" | "discontinued";
  created_at: Date; doctor_name: string; created_by_name: string;
};

export class InvalidPrescription extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = "InvalidPrescription";
  }
}

export class NotFound extends Error {
  constructor() { super("no such prescription for this clinic"); this.name = "NotFound"; }
}

/** Validate at the trust boundary: this is typed by a human in a hurry. */
function validate(input: PrescriptionInput) {
  const drugName = input.drugName?.trim();
  const dosage = input.dosage?.trim();
  if (!drugName) throw new InvalidPrescription("drugName", "a drug name is required");
  if (!dosage) throw new InvalidPrescription("dosage", "a dosage is required");
  if (input.durationDays !== undefined && input.durationDays !== null &&
      (!Number.isInteger(input.durationDays) || input.durationDays < 1)) {
    throw new InvalidPrescription("durationDays", "duration must be a whole number of days");
  }
  return { ...input, drugName, dosage, notes: input.notes?.trim() || undefined };
}

export async function createPrescription(
  db: Db, actor: { kind: "staff"; id: string }, role: Role, raw: PrescriptionInput,
): Promise<{ id: string }> {
  requirePermission(role, "prescriptions:write");
  const input = validate(raw);

  // A doctor at one clinic writing on another clinic's patient is always a bug
  // or an attack; there is no legitimate case for it.
  const [pair] = await db<{ ok: boolean }[]>`
    select (p.clinic_id = d.clinic_id) as ok
      from patients p, doctors d
     where p.id = ${input.patientId} and d.id = ${input.doctorId}`;
  if (!pair?.ok) {
    throw new InvalidPrescription("patientId", "that patient and doctor are at different clinics");
  }

  const [row] = await db<{ id: string }[]>`
    insert into prescriptions
      (patient_id, doctor_id, appointment_id, drug_name, dosage, duration_days, notes, created_by)
    values
      (${input.patientId}, ${input.doctorId}, ${input.appointmentId ?? null},
       ${input.drugName}, ${input.dosage}, ${input.durationDays ?? null},
       ${input.notes ?? null}, ${actor.id})
    returning id`;

  await audit(db, actor, "create_prescription", "prescriptions", row.id);
  return row;
}

export async function listPrescriptions(
  db: Db, actor: Actor, role: Role, clinicId: string, patientId: string,
): Promise<Prescription[]> {
  requirePermission(role, "prescriptions:read");
  const rows = await db<Prescription[]>`
    select p.id, p.drug_name, p.dosage, p.duration_days, p.notes, p.status, p.created_at,
           d.name as doctor_name, s.name as created_by_name
      from prescriptions p
      join doctors d     on d.id = p.doctor_id
      join staff_users s on s.id = p.created_by
      join patients pt   on pt.id = p.patient_id
     where p.patient_id = ${patientId} and pt.clinic_id = ${clinicId}
     order by p.created_at desc`;
  await audit(db, actor, "read_prescriptions", "patients", patientId);
  return rows;
}

export async function discontinuePrescription(
  db: Db, actor: { kind: "staff"; id: string }, role: Role, clinicId: string, id: string,
): Promise<void> {
  requirePermission(role, "prescriptions:write");
  const rows = await db`
    update prescriptions p set status = 'discontinued'
      from patients pt
     where pt.id = p.patient_id and pt.clinic_id = ${clinicId}
       and p.id = ${id}
    returning p.id`;
  if (rows.length === 0) throw new NotFound();
  await audit(db, actor, "discontinue_prescription", "prescriptions", id);
}
