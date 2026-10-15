/**
 * Follow-up tasks: "call Asha with her reports by Friday". A task belongs to
 * the clinic; the patient and the assignee are both optional. Any staff member
 * may complete any task of their clinic.
 */
import type { Db } from "./db";
import { audit, type Actor } from "./audit";
import { DeskError, isId } from "./desk";
import { ownedBy } from "./patients";
import { requirePermission, type Role } from "./rbac";
import { validDay } from "./valid-day";

export const TITLE_MAX = 200;

export type Task = {
  id: string; title: string;
  patient_id: string | null; patient_name: string | null;
  due_on: string | null;   // YYYY-MM-DD
  overdue: boolean;        // open and due before today, in the clinic's timezone
  assigned_to: string | null; assignee_name: string | null;
  done_at: Date | null; created_at: Date;
};

export async function createTask(
  db: Db, actor: Actor, role: Role, clinicId: string,
  input: { title: string; patientId?: string | null; dueOn?: string | null; assignedTo?: string | null },
  doctorId?: string | null,
): Promise<{ id: string }> {
  requirePermission(role, "tasks:write");
  if (actor.kind !== "staff") throw new DeskError("staff only");
  const title = input.title.trim();
  if (!title) throw new DeskError("task title required");
  if (title.length > TITLE_MAX) throw new DeskError(`task title is too long (max ${TITLE_MAX} characters)`);
  const dueOn = input.dueOn || null;
  if (dueOn && validDay(dueOn, "") !== dueOn) throw new DeskError("invalid due date");
  const patientId = input.patientId || null;
  const assignedTo = input.assignedTo || null;

  if (assignedTo) {
    const [s] = isId(assignedTo) ? await db`
      select 1 from staff_users where id = ${assignedTo} and clinic_id = ${clinicId}` : [];
    if (!s) throw new DeskError("unknown assignee");
  }
  if (patientId) {
    const [p] = isId(patientId) ? await db`
      select 1 from patients p
       where p.id = ${patientId} and p.clinic_id = ${clinicId} and p.deleted_at is null
         ${ownedBy(db, doctorId)}` : [];
    if (!p) throw new DeskError("patient not found");
  }

  const [row] = await db<{ id: string }[]>`
    insert into tasks (clinic_id, patient_id, title, due_on, assigned_to, created_by)
    values (${clinicId}, ${patientId}, ${title}, ${dueOn}, ${assignedTo}, ${actor.id})
    returning id`;
  await audit(db, actor, "create_task", "tasks", row.id);
  return row;
}

/** Idempotent: a second "Done" keeps the time it was first done. A doctor may
 *  close only a task he could see in listTasks. */
export async function completeTask(
  db: Db, actor: Actor, role: Role, clinicId: string, taskId: string,
  doctorId?: string | null,
): Promise<void> {
  requirePermission(role, "tasks:write");
  const me = actor.kind === "staff" ? actor.id : null;
  const [row] = isId(taskId) ? await db`
    update tasks k set done_at = coalesce(k.done_at, now())
     where k.id = ${taskId} and k.clinic_id = ${clinicId}
       and (k.patient_id is null or k.assigned_to = ${me} or exists (
             select 1 from patients p where p.id = k.patient_id ${ownedBy(db, doctorId)}))
     returning k.id` : [];
  if (!row) throw new DeskError("task not found");
  await audit(db, actor, "complete_task", "tasks", taskId);
}

/** Open tasks soonest first (undated last); done ones after, newest first.
 *  A doctor sees tasks on his own patients, patient-less ones, and his own;
 *  nobody sees tasks on a withdrawn (soft-deleted) patient. */
export async function listTasks(
  db: Db, actor: Actor, role: Role, clinicId: string,
  filter: { assignedTo?: string; patientId?: string; open?: boolean },
  doctorId?: string | null,
): Promise<Task[]> {
  requirePermission(role, "tasks:write");
  const me = actor.kind === "staff" ? actor.id : null;
  const [rows] = await Promise.all([
    db<Task[]>`
      select k.id, k.title, k.patient_id, p.name as patient_name,
             to_char(k.due_on, 'YYYY-MM-DD') as due_on,
             (k.done_at is null and k.due_on < (now() at time zone c.timezone)::date) as overdue,
             k.assigned_to, s.name as assignee_name, k.done_at, k.created_at
        from tasks k
        join clinics c on c.id = k.clinic_id
        left join patients p on p.id = k.patient_id
        left join staff_users s on s.id = k.assigned_to
       where k.clinic_id = ${clinicId}
         and (${filter.assignedTo ?? null}::uuid is null or k.assigned_to = ${filter.assignedTo ?? null})
         and (${filter.patientId ?? null}::uuid is null or k.patient_id = ${filter.patientId ?? null})
         and (${!filter.open} or k.done_at is null)
         -- A withdrawn patient's tasks go with the record.
         and (k.patient_id is null or (p.deleted_at is null
              and (k.assigned_to = ${me} or (true ${ownedBy(db, doctorId)}))))
       order by k.done_at desc nulls first, k.due_on asc nulls last, k.created_at
       limit 200`,
    audit(db, actor, "list_tasks", "tasks", null),
  ]);
  return rows;
}
