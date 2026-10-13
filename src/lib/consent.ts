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

/**
 * The first words a patient ever reads from the clinic. A bare consent notice
 * opening with "Before we book..." answers a question they did not ask, so say
 * who is writing and what this can do, then ask.
 */
export const introduction = (clinicName: string) =>
  `Hello! I am the booking assistant for ${clinicName}. I can book, move or ` +
  `cancel your appointments. For anything medical, a member of the clinic ` +
  `team will answer you themselves.\n\n${CONSENT_NOTICE}`;

const AFFIRMATIVE = new Set([
  "yes", "y", "ok", "okay", "k", "sure", "agree", "i agree", "yes i agree",
  "haan", "han", "ha", "haa", "ji", "haan ji", "ji haan", "हाँ", "हां", "👍",
]);

/**
 * A plain "yes" in any of the ways people actually send it ("Yes, I agree.").
 * Whole-message match only: "ok but not today" is not consent, and the model —
 * which sometimes reads a bare "OK" as unclear — is not asked.
 */
export const isAffirmative = (body: string) =>
  AFFIRMATIVE.has(body.toLowerCase().replace(/\p{P}/gu, " ").trim().replace(/\s+/g, " "));

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

/**
 * How long a soft-deleted record survives before it is destroyed.
 *
 * Not zero, deliberately: a withdrawal sent by mistake, and a dispute about
 * whether an appointment happened, both need a short window. Thirty days is a
 * choice, not a legal finding — confirm it with counsel before a real clinic.
 */
export const PURGE_AFTER_DAYS = 30;

/**
 * Hard-delete patients whose retention window has passed (docs/02).
 *
 * Their appointments, conversations, messages, prescriptions, reminders and
 * consent-log rows go with them via `on delete cascade`. The audit_log entry
 * survives holding only the patient's id: it records that a deletion happened,
 * which is itself an obligation, and nothing about who they were.
 */
export async function purgeDeletedPatients(
  db: Db, now = new Date(),
): Promise<{ purged: number }> {
  const cutoff = new Date(now.getTime() - PURGE_AFTER_DAYS * 86_400_000);
  const rows = await db<{ id: string }[]>`
    select id from patients where deleted_at is not null and deleted_at < ${cutoff}`;

  for (const row of rows) {
    await db`delete from patients where id = ${row.id}`;
    await audit(db, { kind: "agent" }, "patient_purged", "patients", row.id);
  }
  return { purged: rows.length };
}
