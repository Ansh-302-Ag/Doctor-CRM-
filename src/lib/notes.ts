/**
 * Front-desk notes on a patient. Append-only: there is no edit or delete, so a
 * note on the record is exactly what was written at the time. The timeline
 * (src/lib/timeline.ts) is where they are read.
 */
import type { Db } from "./db";
import { audit, type Actor } from "./audit";
import { DeskError, isId } from "./desk";
import { ownedBy } from "./patients";
import { requirePermission, type Role } from "./rbac";

export const NOTE_MAX = 2000;

export async function addNote(
  db: Db, actor: Actor, role: Role, clinicId: string, patientId: string, body: string,
  doctorId?: string | null,
): Promise<{ id: string }> {
  requirePermission(role, "patients:write");
  const text = body.trim();
  if (!text) throw new DeskError("note is empty");
  if (text.length > NOTE_MAX) throw new DeskError(`note is too long (max ${NOTE_MAX} characters)`);
  if (!isId(patientId) || actor.kind !== "staff") throw new DeskError("patient not found");

  // The scope check and the write are one statement: no row, no note.
  const [row] = await db<{ id: string }[]>`
    insert into patient_notes (patient_id, body, created_by)
    select p.id, ${text}, ${actor.id} from patients p
     where p.id = ${patientId} and p.clinic_id = ${clinicId} and p.deleted_at is null
       ${ownedBy(db, doctorId)}
    returning id`;
  if (!row) throw new DeskError("patient not found");
  await audit(db, actor, "add_note", "patients", patientId);
  return row;
}
