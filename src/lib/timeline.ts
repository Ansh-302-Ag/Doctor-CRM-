/**
 * One chronological feed per patient: appointments, messages, escalations,
 * prescriptions, consent, notes and tasks. A read-time UNION over the existing
 * tables rather than an events table, so no write path changes (spec: Decided).
 */
import type { Db } from "./db";
import { audit, type Actor } from "./audit";
import { can, requirePermission, type Role } from "./rbac";
import { ownedBy } from "./patients";

export type TimelineItem = {
  at: Date;
  kind: "appointment" | "message" | "escalation" | "prescription" | "consent" | "note" | "task";
  title: string;
  detail: string | null;
  by: "agent" | "staff" | "patient" | null;
  byName: string | null;
  refId: string;
};

export async function getTimeline(
  db: Db, actor: Actor, role: Role, clinicId: string, patientId: string,
  opts: { before?: Date; limit?: number; doctorId?: string | null },
): Promise<TimelineItem[]> {
  requirePermission(role, "patients:read");
  const limit = opts.limit ?? 50;
  // Every branch filters on the literal patient id so it uses that table's own
  // patient index; `pt` only gates on scope (no row → nothing) and carries the
  // clinic's timezone for the appointment times written into titles.
  const escalations = can(role, "escalations:read") ? db`
    union all
    select e.created_at,'escalation',
           case when e.priority = 'emergency' then 'Emergency escalation' else 'Escalated to the desk' end
             || ' · ' || e.status,
           e.reason, null, null, e.id
      from pt, escalations e where e.patient_id = ${patientId}` : db``;

  const [rows] = await Promise.all([
    db<(Omit<TimelineItem, "by" | "byName" | "refId"> & {
      by_kind: TimelineItem["by"]; by_name: string | null; ref_id: string;
    })[]>`
      with pt as (
        select p.id, c.timezone as tz
          from patients p join clinics c on c.id = p.clinic_id
         where p.id = ${patientId} and p.clinic_id = ${clinicId} and p.deleted_at is null
           ${ownedBy(db, opts.doctorId)})
      select date_trunc('milliseconds', t.at) as at, t.kind, t.title, t.detail,
             t.by_kind, t.by_name, t.ref_id
        from (
          -- An appointment yields its booking, its arrival and its outcome.
          select ev.at, 'appointment'::text as kind,
                 ev.verb || ' ' || to_char(a.starts_at at time zone pt.tz, 'FMDD Mon YYYY, HH24:MI')
                   || ' with ' || d.name as title,
                 case when ev.verb = 'Booked' then a.reason_text end as detail,
                 case when ev.verb <> 'Booked' then null
                      when a.created_by = 'agent' then 'agent' else 'staff' end::text as by_kind,
                 case when ev.verb <> 'Booked' then null
                      when a.created_by = 'agent' then 'AI assistant' else s.name end as by_name,
                 a.id as ref_id
            from pt, appointments a
            join doctors d on d.id = a.doctor_id
            left join staff_users s on s.id::text = a.created_by
            cross join lateral (values
              (a.created_at, 'Booked'),
              (a.arrived_at, 'Arrived for'),
              (case when a.status <> 'booked' then a.updated_at end,
               case a.status when 'completed' then 'Completed' when 'no_show' then 'No-show for'
                             when 'cancelled' then 'Cancelled' else 'Rescheduled' end)
            ) ev(at, verb)
           where a.patient_id = ${patientId} and ev.at is not null
          union all
          select m.created_at, 'message',
                 case when length(m.body) > 140 then left(m.body, 139) || '…' else m.body end,
                 case when length(m.body) > 140 then m.body end,
                 case m.direction when 'inbound' then 'patient' else 'agent' end, null, m.id
            from pt, conversations cv join messages m on m.conversation_id = cv.id
           where cv.patient_id = ${patientId}
          ${escalations}
          union all
          select r.created_at, 'prescription', 'Prescribed ' || r.drug_name || ' — ' || r.dosage,
                 r.notes, 'staff', s.name, r.id
            from pt, prescriptions r join staff_users s on s.id = r.created_by
           where r.patient_id = ${patientId}
          union all
          select cl.created_at, 'consent',
                 'Consent ' || cl.action || case cl.channel
                   when 'whatsapp' then ' on WhatsApp' when 'voice' then ' on a call'
                   when 'desk' then ' at the desk' else ' (' || cl.channel || ')' end,
                 'Notice ' || cl.notice_version,
                 case when cl.channel = 'desk' then 'staff' else 'patient' end, null, cl.id
            from pt, consent_log cl where cl.patient_id = ${patientId}
          union all
          select n.created_at, 'note', 'Note', n.body, 'staff', s.name, n.id
            from pt, patient_notes n join staff_users s on s.id = n.created_by
           where n.patient_id = ${patientId}
          union all
          select k.created_at, 'task', 'Task: ' || k.title,
                 nullif(concat_ws(' · ', 'due ' || to_char(k.due_on, 'FMDD Mon YYYY'),
                                  case when k.done_at is not null then 'done' end), ''),
                 'staff', s.name, k.id
            from pt, tasks k join staff_users s on s.id = k.created_by
           where k.patient_id = ${patientId}
        ) t
       -- Truncated to what a JS Date holds, so ?before= round-trips exactly, and
       -- WITH TIES so a page never ends halfway through one instant.
       where ${opts.before ?? null}::timestamptz is null
          or date_trunc('milliseconds', t.at) < ${opts.before ?? null}
       order by 1 desc
       fetch first (${limit}) rows with ties`,
    audit(db, actor, "read_timeline", "patients", patientId),
  ]);
  return rows.map(({ by_kind, by_name, ref_id, ...r }) =>
    ({ ...r, by: by_kind, byName: by_name, refId: ref_id }));
}
