import type { Db } from "./db";
import { audit, type Actor } from "./audit";
import { requirePermission, type Role } from "./rbac";

/** The inbox itself. A doctor has no inbox (docs/08) and is refused here, not
 *  merely in the navigation — the page is reachable by typing the URL. */
export async function listEscalations(db: Db, actor: Actor, role: Role, clinicId: string) {
  requirePermission(role, "escalations:read");
  // Reading this list means reading every escalated patient's name and number,
  // so it is audited — but the audit row does not depend on the read, so the
  // two go out together rather than one after the other, saving a round trip.
  // `db` may be a transaction handle; postgres.js pipelines concurrent queries
  // down the one connection, so both still land inside that transaction.
  const [rows] = await Promise.all([
    db<{
      id: string; reason: string; priority: string; status: string;
      created_at: Date; resolved_at: Date | null;
      patient_name: string | null; patient_phone: string;
      assigned_to_name: string | null; last_message: string | null;
    }[]>`
      select e.id, e.reason, e.priority, e.status, e.created_at, e.resolved_at,
             p.name as patient_name, p.phone as patient_phone,
             s.name as assigned_to_name,
             (select m.body from messages m
               where m.conversation_id = e.conversation_id and m.direction = 'inbound'
               order by m.created_at desc limit 1) as last_message
        from escalations e
        join patients p on p.id = e.patient_id
        left join staff_users s on s.id = e.assigned_to
       where p.clinic_id = ${clinicId} and p.deleted_at is null
       order by (e.status <> 'resolved') desc,
                (e.priority = 'emergency') desc,
                e.created_at desc
       limit 200`,
    audit(db, actor, "read_escalations", "escalations", null),
  ]);
  return rows;
}

export class NotFound extends Error {
  constructor() { super("no such escalation for this clinic"); this.name = "NotFound"; }
}

/**
 * Staff take ownership, then close. The agent can do neither (docs/08).
 *
 * Both are scoped by clinic, not just by id: the id arrives from a form field,
 * and without the scope a staff member at one clinic could resolve — and so
 * silently bury — another clinic's open emergency.
 */
export async function acknowledgeEscalation(
  db: Db, actor: Actor, role: Role, clinicId: string, id: string, staffId: string,
) {
  requirePermission(role, "escalations:resolve");
  const rows = await db`
    update escalations e set status = 'acknowledged', assigned_to = ${staffId}
      from patients p
     where e.patient_id = p.id and p.clinic_id = ${clinicId}
       and e.id = ${id} and e.status = 'open'
    returning e.id`;
  if (rows.length === 0) throw new NotFound();
  await audit(db, actor, "acknowledge_escalation", "escalations", id);
}

export async function resolveEscalation(
  db: Db, actor: Actor, role: Role, clinicId: string, id: string,
) {
  requirePermission(role, "escalations:resolve");
  const rows = await db`
    update escalations e set status = 'resolved', resolved_at = now()
      from patients p
     where e.patient_id = p.id and p.clinic_id = ${clinicId}
       and e.id = ${id} and e.status <> 'resolved'
    returning e.id`;
  if (rows.length === 0) throw new NotFound();
  await audit(db, actor, "resolve_escalation", "escalations", id);
}
