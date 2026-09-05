/**
 * Patient lookup for the CRM.
 *
 * Every query is scoped by clinic and excludes soft-deleted patients — an id
 * arriving from a URL is not proof of anything (docs/08).
 */
import type { Db } from "./db";
import { audit, type Actor } from "./audit";
import { requirePermission, type Role } from "./rbac";

export type PatientSummary = {
  id: string; name: string | null; phone: string;
  consent_status: "pending" | "granted" | "withdrawn";
  next_appointment: Date | null; active_prescriptions: number;
};

export async function searchPatients(
  db: Db, actor: Actor, role: Role, clinicId: string, query: string,
): Promise<PatientSummary[]> {
  requirePermission(role, "patients:read");
  const q = query.trim();
  const like = `%${q}%`;

  const rows = await db<PatientSummary[]>`
    select p.id, p.name, p.phone, p.consent_status,
           (select min(a.starts_at) from appointments a
             where a.patient_id = p.id and a.status = 'booked' and a.starts_at > now()
           ) as next_appointment,
           (select count(*) from prescriptions r
             where r.patient_id = p.id and r.status = 'active'
           )::int as active_prescriptions
      from patients p
     where p.clinic_id = ${clinicId} and p.deleted_at is null
       and (${q === ""} or p.name ilike ${like} or p.phone ilike ${like})
     order by p.name nulls last, p.created_at desc
     limit 100`;

  await audit(db, actor, "search_patients", "patients", null);
  return rows;
}

export async function getPatient(
  db: Db, actor: Actor, role: Role, clinicId: string, patientId: string,
): Promise<PatientSummary | null> {
  requirePermission(role, "patients:read");
  const [row] = await db<PatientSummary[]>`
    select p.id, p.name, p.phone, p.consent_status,
           (select min(a.starts_at) from appointments a
             where a.patient_id = p.id and a.status = 'booked' and a.starts_at > now()
           ) as next_appointment,
           (select count(*) from prescriptions r
             where r.patient_id = p.id and r.status = 'active'
           )::int as active_prescriptions
      from patients p
     where p.id = ${patientId} and p.clinic_id = ${clinicId} and p.deleted_at is null`;
  if (!row) return null;
  await audit(db, actor, "read_patient", "patients", patientId);
  return row;
}

/** Record a name the patient gave us. Never blanks out one we already have. */
export async function setPatientName(
  db: Db, actor: Actor, patientId: string, name: string,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  await db`update patients set name = ${trimmed} where id = ${patientId}`;
  await audit(db, actor, "set_patient_name", "patients", patientId);
}
