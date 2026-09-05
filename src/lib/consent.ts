import type { Db } from "./db";
import { audit, type Actor } from "./audit";

/** Bump whenever CONSENT_NOTICE changes — consent is recorded against the exact
 *  version of the notice the patient saw (docs/02). */
export const NOTICE_VERSION = "2026-09-01";

export const CONSENT_NOTICE =
  "Before we book, we need your OK to store your name, phone number, what you tell " +
  "us when booking, and your appointment and prescription history. It is used only " +
  "to book your visits, send reminders, and keep the doctor's record. You can " +
  "withdraw anytime by replying DELETE. Reply YES to agree.";

export class ConsentRequired extends Error {
  constructor() { super("consent has not been granted"); this.name = "ConsentRequired"; }
}

export async function assertConsent(db: Db, patientId: string) {
  const [p] = await db<{ consent_status: string }[]>`
    select consent_status from patients where id = ${patientId} and deleted_at is null
  `;
  if (!p) throw new Error(`unknown patient ${patientId}`);
  if (p.consent_status !== "granted") throw new ConsentRequired();
}

export async function recordConsent(
  db: Db, actor: Actor, patientId: string,
  action: "granted" | "withdrawn", channel = "whatsapp",
) {
  // Re-consenting revives a soft-deleted patient. Without clearing deleted_at
  // the patient is walked through the whole consent flow and then permanently
  // fails to book, because assertConsent filters soft-deleted rows out.
  await db`
    update patients
       set consent_status      = ${action}::consent_status,
           consent_recorded_at = ${action === "granted" ? new Date() : null},
           deleted_at          = ${action === "granted" ? null : db`deleted_at`}
     where id = ${patientId}
  `;
  await db`
    insert into consent_log (patient_id, action, notice_version, channel)
    values (${patientId}, ${action}, ${NOTICE_VERSION}, ${channel})
  `;
  await audit(db, actor, `consent_${action}`, "patients", patientId);
}

/**
 * DPDP withdrawal (docs/02): soft-delete now, keep the append-only consent trail,
 * cancel anything still scheduled. A purge job hard-deletes later.
 *
 * The caller must supply a transaction: a half-executed deletion — consent
 * withdrawn but the record still live, or appointments cancelled but the
 * patient not marked deleted — is worse than an outright failure.
 */
export async function withdrawAndDelete(db: Db, actor: Actor, patientId: string) {
  await recordConsent(db, actor, patientId, "withdrawn");
  await db`update appointments set status = 'cancelled', updated_at = now()
            where patient_id = ${patientId} and status = 'booked'`;
  await db`update reminders set status = 'cancelled'
            where patient_id = ${patientId} and status = 'scheduled'`;
  await db`update patients set deleted_at = now() where id = ${patientId}`;
  await audit(db, actor, "patient_soft_deleted", "patients", patientId);
}
