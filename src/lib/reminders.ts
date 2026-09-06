/**
 * Reminders.
 *
 * The rule that shapes this file (docs/08): a reminder re-checks the world at
 * SEND time, never trusting what was true when it was scheduled. A prescription
 * discontinued yesterday must not be reminded about today; an appointment
 * cancelled this morning must not be reminded about this afternoon.
 *
 * A silently failed reminder is a real harm, not a UX bug, so one that cannot
 * be delivered escalates to a human rather than disappearing.
 */
import type { Db } from "./db";
import { audit } from "./audit";
import { sendTemplate } from "./channel";
import { renderTemplate } from "./templates";

export const MAX_ATTEMPTS = 3;
/** How long before an appointment the reminder goes out. */
export const LEAD_TIME_MS = 24 * 60 * 60 * 1000;
/** Arbitrary constant identifying the reminder-run advisory lock. */
const RUN_LOCK_KEY = 4_726_301;

export type DueReminder = {
  id: string; patient_id: string; type: "appointment" | "refill_followup";
  related_id: string; attempts: number; phone: string;
  clinic_name: string; doctor_name: string | null;
  starts_at: Date | null; drug_name: string | null; timezone: string;
};

export async function scheduleAppointmentReminder(
  db: Db, appointmentId: string, patientId: string, startsAt: Date,
): Promise<void> {
  const sendAt = new Date(startsAt.getTime() - LEAD_TIME_MS);
  // An appointment booked inside the lead time gets no reminder — messaging
  // someone about a visit they just booked is noise.
  if (sendAt <= new Date()) return;
  await db`
    insert into reminders (patient_id, type, related_id, send_at, template_name)
    values (${patientId}, 'appointment', ${appointmentId}, ${sendAt}, 'appointment_reminder')
    on conflict do nothing`;
}

export async function scheduleRefillFollowup(
  db: Db, prescriptionId: string, patientId: string, sendAt: Date,
): Promise<void> {
  await db`
    insert into reminders (patient_id, type, related_id, send_at, template_name)
    values (${patientId}, 'refill_followup', ${prescriptionId}, ${sendAt}, 'refill_followup')
    on conflict do nothing`;
}

export async function cancelReminders(db: Db, relatedId: string): Promise<void> {
  await db`update reminders set status = 'cancelled'
            where related_id = ${relatedId} and status = 'scheduled'`;
}

/** Everything due now, with the context needed to fill a template. */
export async function claimDue(db: Db, now = new Date(), limit = 50): Promise<DueReminder[]> {
  const rows = await db<DueReminder[]>`
    select r.id, r.patient_id, r.type, r.related_id, r.attempts,
           p.phone, c.name as clinic_name, c.timezone,
           d.name as doctor_name, a.starts_at, pr.drug_name
      from reminders r
      join patients p on p.id = r.patient_id
      join clinics  c on c.id = p.clinic_id
      left join appointments a   on a.id = r.related_id and r.type = 'appointment'
      left join doctors d        on d.id = a.doctor_id
      left join prescriptions pr on pr.id = r.related_id and r.type = 'refill_followup'
     where r.status = 'scheduled' and r.send_at <= ${now}
     order by r.send_at
     limit ${limit}`;
  // This is a read of every claimed patient's contact details — audit the batch
  // once rather than once per row; the per-reminder outcome (sent/skipped) is
  // already recorded below.
  if (rows.length) {
    await audit(db, { kind: "agent" }, "read_for_reminders", "reminders", null);
  }
  return rows;
}

/**
 * Is this reminder still worth sending? Checked immediately before the send,
 * because everything it depends on can change after scheduling.
 */
export async function stillValid(db: Db, r: DueReminder): Promise<boolean> {
  const [patient] = await db<{ consent_status: string; deleted_at: Date | null }[]>`
    select consent_status, deleted_at from patients where id = ${r.patient_id}`;
  if (!patient || patient.deleted_at || patient.consent_status !== "granted") return false;

  if (r.type === "appointment") {
    const [a] = await db<{ status: string }[]>`
      select status from appointments where id = ${r.related_id}`;
    return a?.status === "booked";
  }
  const [p] = await db<{ status: string }[]>`
    select status from prescriptions where id = ${r.related_id}`;
  return p?.status === "active";
}

function parametersFor(r: DueReminder) {
  if (r.type === "appointment") {
    return renderTemplate("appointment_reminder", {
      clinic_name: r.clinic_name,
      doctor_name: r.doctor_name ?? "the clinic",
      appointment_time: new Intl.DateTimeFormat("en-GB", {
        timeZone: r.timezone, weekday: "short", day: "numeric", month: "short",
        hour: "numeric", minute: "2-digit", hour12: true,
      }).format(r.starts_at!),
    });
  }
  return renderTemplate("refill_followup", {
    clinic_name: r.clinic_name, drug_name: r.drug_name ?? "your prescription",
  });
}

type RunResult = { sent: number; skipped: number; failed: number };

async function sendDue(
  db: Db, send: typeof sendTemplate, now?: Date,
): Promise<RunResult> {
  let sent = 0, skipped = 0, failed = 0;

  for (const r of await claimDue(db, now)) {
    if (!(await stillValid(db, r))) {
      await db`update reminders set status = 'cancelled' where id = ${r.id}`;
      await audit(db, { kind: "agent" }, "reminder_skipped", "reminders", r.id);
      skipped++;
      continue;
    }
    try {
      const rendered = parametersFor(r);
      await send({ to: r.phone, name: rendered.name, parameters: rendered.parameters });
      await db`update reminders set status = 'sent', sent_at = now(),
                                    attempts = attempts + 1, last_error = null
                where id = ${r.id}`;
      await audit(db, { kind: "agent" }, "reminder_sent", "reminders", r.id);
      sent++;
    } catch (e) {
      const message = (e as Error).message;
      await db`
        update reminders
           set attempts   = attempts + 1,
               last_error = ${message.slice(0, 500)},
               status     = case when attempts + 1 >= ${MAX_ATTEMPTS}
                                 then 'failed'::reminder_status
                                 else 'scheduled'::reminder_status end,
               -- back off: 15 minutes, then an hour, then it fails
               send_at    = now() + (interval '15 minutes' * power(4, attempts))
         where id = ${r.id}`;

      const [row] = await db<{ status: string }[]>`
        select status from reminders where id = ${r.id}`;
      if (row.status === "failed") {
        // docs/08: after N attempts a human is told. Silence here is the harm.
        // The patient may never have texted the clinic (booked at the front
        // desk), so there may be no conversation to attach — escalate anyway,
        // with a null conversation_id (migration 007), rather than dropping it.
        const [conversation] = await db<{ id: string }[]>`
          select id from conversations where patient_id = ${r.patient_id} limit 1`;
        await db`
          insert into escalations (conversation_id, patient_id, reason, priority)
          values (${conversation?.id ?? null}, ${r.patient_id},
                  ${`reminder could not be delivered after ${MAX_ATTEMPTS} attempts: ${message}`},
                  'normal')`;
        failed++;
      }
    }
  }
  return { sent, skipped, failed };
}

/** Send everything due. Returns counts rather than throwing, so one bad
 *  reminder never stops the batch. */
export async function runDueReminders(
  db: Db, deps: { send?: typeof sendTemplate; now?: Date } = {},
): Promise<RunResult> {
  const send = deps.send ?? sendTemplate;
  const zero: RunResult = { sent: 0, skipped: 0, failed: 0 };

  // One reminder run at a time. Two overlapping cron invocations would each
  // claim the same 'scheduled' rows and message the patient twice; the lock is
  // cheaper than row-level claiming and holds nothing across a network send.
  // Advisory locks are held per Postgres session, so lock and unlock must run
  // on the SAME connection — reserve() pins one from the pool. A caller already
  // inside a transaction (Db can be a TransactionSql) is already pinned.
  const reserved = "reserve" in db ? await db.reserve() : null;
  const runDb: Db = reserved ?? db;
  try {
    const [lock] = await runDb<{ locked: boolean }[]>`
      select pg_try_advisory_lock(${RUN_LOCK_KEY}) as locked`;
    if (!lock.locked) return zero;
    try {
      return await sendDue(runDb, send, deps.now);
    } finally {
      await runDb`select pg_advisory_unlock(${RUN_LOCK_KEY})`;
    }
  } finally {
    reserved?.release();
  }
}
