/**
 * Merging two records of the same person (a walk-in registered under one number,
 * a WhatsApp chat under another). Everything the duplicate has moves to the kept
 * record — consent trail included — and the emptied duplicate is hard-deleted.
 * A later message from its old number is simply a new contact.
 *
 * Re-pointing patient_id never changes an appointment's doctor or time, so the
 * per-doctor no-overlap constraint cannot fire: rows that coexisted before the
 * merge coexist after it.
 */
import type { Db, Pool } from "./db";
import { audit, type Actor } from "./audit";
import { DeskError, isId } from "./desk";
import { requirePermission, type Role } from "./rbac";

export type MergeCounts = {
  appointments: number; conversations: number; messages: number; prescriptions: number;
  reminders: number; escalations: number; consents: number; notes: number; tasks: number;
};

/** Both records live in this clinic and are not deleted; locked when `lock`. */
async function checkPair(db: Db, clinicId: string, keepId: string, dropId: string, lock: boolean) {
  if (!isId(keepId) || !isId(dropId)) throw new DeskError("patient not found");
  if (keepId === dropId) throw new DeskError("cannot merge a record with itself");
  const rows = await db`
    select id from patients
     where id in (${keepId}, ${dropId}) and clinic_id = ${clinicId} and deleted_at is null
     ${lock ? db`for update` : db``}`;
  if (rows.length !== 2) throw new DeskError("patient not found");
}

/** What the duplicate would bring across. */
async function counts(db: Db, dropId: string): Promise<MergeCounts> {
  const [c] = await db<MergeCounts[]>`
    select
      (select count(*) from appointments  where patient_id = ${dropId})::int as appointments,
      (select count(*) from conversations where patient_id = ${dropId})::int as conversations,
      (select count(*) from messages m join conversations c on c.id = m.conversation_id
        where c.patient_id = ${dropId})::int as messages,
      (select count(*) from prescriptions where patient_id = ${dropId})::int as prescriptions,
      (select count(*) from reminders     where patient_id = ${dropId})::int as reminders,
      (select count(*) from escalations   where patient_id = ${dropId})::int as escalations,
      (select count(*) from consent_log   where patient_id = ${dropId})::int as consents,
      (select count(*) from patient_notes where patient_id = ${dropId})::int as notes,
      (select count(*) from tasks         where patient_id = ${dropId})::int as tasks`;
  return c;
}

export async function previewMerge(
  db: Db, actor: Actor, role: Role, clinicId: string, keepId: string, dropId: string,
): Promise<MergeCounts> {
  requirePermission(role, "patients:merge");
  await checkPair(db, clinicId, keepId, dropId, false);
  const [c] = await Promise.all([
    counts(db, dropId),
    audit(db, actor, "preview_merge", "patients", keepId),
    audit(db, actor, "preview_merge", "patients", dropId),
  ]);
  return c;
}

export async function mergePatients(
  pool: Pool, actor: Actor, role: Role, clinicId: string, keepId: string, dropId: string,
): Promise<MergeCounts> {
  requirePermission(role, "patients:merge");
  return pool.begin(async tx => {
    // Locked so a second desk merging the same pair waits, then finds one gone.
    await checkPair(tx, clinicId, keepId, dropId, true);
    const moved = await counts(tx, dropId);

    for (const t of ["appointments", "prescriptions", "reminders", "escalations",
                     "consent_log", "patient_notes", "tasks"]) {
      await tx`update ${tx(t)} set patient_id = ${keepId} where patient_id = ${dropId}`;
    }

    // One conversation per patient and channel: where both have one, the
    // duplicate's messages and escalations join the kept conversation (whose
    // agent state stays as it is) and the duplicate's is deleted.
    await tx`
      update conversations kc
         set started_at = least(kc.started_at, dc.started_at),
             last_message_at = greatest(kc.last_message_at, dc.last_message_at)
        from conversations dc
       where kc.patient_id = ${keepId} and dc.patient_id = ${dropId} and dc.channel = kc.channel`;
    for (const t of ["messages", "escalations"]) {
      await tx`
        update ${tx(t)} x set conversation_id = kc.id
          from conversations dc join conversations kc
            on kc.patient_id = ${keepId} and kc.channel = dc.channel
         where dc.patient_id = ${dropId} and x.conversation_id = dc.id`;
    }
    await tx`
      delete from conversations dc using conversations kc
       where dc.patient_id = ${dropId} and kc.patient_id = ${keepId} and kc.channel = dc.channel`;
    await tx`update conversations set patient_id = ${keepId} where patient_id = ${dropId}`;

    // Granted if either agreed, as of the latest agreement.
    await tx`
      update patients k set
        name = coalesce(k.name, d.name),
        consent_status = case when d.consent_status = 'granted' then 'granted' else k.consent_status end,
        consent_recorded_at = case
          when d.consent_status <> 'granted' then k.consent_recorded_at
          when k.consent_status <> 'granted' then d.consent_recorded_at
          else greatest(k.consent_recorded_at, d.consent_recorded_at) end
        from patients d
       where k.id = ${keepId} and d.id = ${dropId}`;
    await tx`delete from patients where id = ${dropId}`;

    await audit(tx, actor, "merge_patients", "patients", keepId);
    await audit(tx, actor, "merge_patients", "patients", dropId);
    return moved;
  });
}
