import type { Db } from "./db";
import { audit, type Actor } from "./audit";
import { requirePermission, type Role } from "./rbac";

export async function listEscalations(db: Db, clinicId: string) {
  return db<{
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
     where p.clinic_id = ${clinicId}
     order by (e.status <> 'resolved') desc,
              (e.priority = 'emergency') desc,
              e.created_at desc
     limit 200`;
}

/** Staff take ownership, then close. The agent can do neither (docs/08). */
export async function acknowledgeEscalation(
  db: Db, actor: Actor, role: Role, id: string, staffId: string,
) {
  requirePermission(role, "escalations:resolve");
  await db`update escalations set status = 'acknowledged', assigned_to = ${staffId}
            where id = ${id} and status = 'open'`;
  await audit(db, actor, "acknowledge_escalation", "escalations", id);
}

export async function resolveEscalation(db: Db, actor: Actor, role: Role, id: string) {
  requirePermission(role, "escalations:resolve");
  await db`update escalations set status = 'resolved', resolved_at = now()
            where id = ${id} and status <> 'resolved'`;
  await audit(db, actor, "resolve_escalation", "escalations", id);
}
