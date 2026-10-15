/**
 * Secure links to a patient's prescriptions.
 *
 * Meta's Business Messaging Policy forbids sending health information over
 * WhatsApp, so the record never goes in chat. The patient gets a link; the page
 * behind it asks for a one-time code sent to their WhatsApp number, and only
 * then shows the record — exactly as the doctor entered it (docs/01).
 *
 * Only SHA-256 hashes of the token and the code are stored. A link is dead
 * when it has expired, is locked by wrong codes, or the patient is deleted or
 * has withdrawn consent.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { Db } from "./db";
import { audit } from "./audit";
import { inWindow, sendMessage, sendTemplate } from "./channel";

export const LINK_TTL_DAYS = 7;
export const CODE_TTL_MINUTES = 10;
export const MAX_WRONG_CODES = 5;
export const MAX_CODES_PER_HOUR = 3;
export const VIEW_MINUTES = 15;

const MIN = 60_000;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Links are built from APP_URL. In production a missing APP_URL is an error,
 *  never a silent localhost link in a patient's WhatsApp. */
export function appUrl(): string {
  const url = process.env.APP_URL?.replace(/\/+$/, "");
  if (url) return url;
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_URL must be set in production — prescription links are built from it");
  }
  return "http://localhost:3000";
}

export async function createRecordLink(db: Db, patientId: string, now = new Date()) {
  const url = appUrl();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + LINK_TTL_DAYS * 24 * 60 * MIN);
  // No RETURNING: the agent role may insert a link but never read one back.
  await db`insert into record_links (patient_id, token_hash, expires_at)
           values (${patientId}, ${sha256(token)}, ${expiresAt})`;
  return { token, url: `${url}/r/${token}`, expiresAt };
}

type LinkRow = {
  id: string; patient_id: string; expires_at: Date; locked_at: Date | null;
  code_hash: string | null; code_expires_at: Date | null; wrong_codes: number;
  phone: string; clinic_name: string; alive: boolean;
};

/** The link behind a token, with whether the patient side still allows it. */
async function findLink(db: Db, token: string, now: Date): Promise<LinkRow | null> {
  if (typeof token !== "string" || token.length > 100) return null;
  const [row] = await db<LinkRow[]>`
    select l.id, l.patient_id, l.expires_at, l.locked_at, l.code_hash, l.code_expires_at,
           l.wrong_codes, p.phone, c.name as clinic_name,
           (l.expires_at > ${now} and p.deleted_at is null
            and p.consent_status <> 'withdrawn') as alive
      from record_links l
      join patients p on p.id = l.patient_id
      join clinics  c on c.id = p.clinic_id
     where l.token_hash = ${sha256(token)}`;
  return row ?? null;
}

/** For the page before verification: the clinic's name and the last two
 *  digits of the number the code goes to (plus the link id, never shown).
 *  Null when dead. */
export async function linkPreview(db: Db, token: string, now = new Date()) {
  const l = await findLink(db, token, now);
  if (!l || !l.alive || l.locked_at) return null;
  return { linkId: l.id, clinicName: l.clinic_name, phoneEnding: l.phone.slice(-2) };
}

/** Issue a fresh code for a live link; the caller sends it. A new code
 *  replaces any earlier one. At most MAX_CODES_PER_HOUR per link. */
export async function issueCode(db: Db, token: string, now = new Date()): Promise<
  | { ok: true; code: string; phone: string; clinicName: string; patientId: string }
  | { ok: false; reason: "invalid" | "rate_limited" }
> {
  const l = await findLink(db, token, now);
  if (!l || !l.alive || l.locked_at) return { ok: false, reason: "invalid" };
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const hourAgo = new Date(now.getTime() - 60 * MIN);
  // One statement, so two quick taps cannot both slip under the limit.
  const updated = await db`
    update record_links
       set code_hash = ${sha256(code)},
           code_expires_at = ${new Date(now.getTime() + CODE_TTL_MINUTES * MIN)},
           codes_sent_at = array(select t from unnest(codes_sent_at) t where t > ${hourAgo})
                           || ${now}::timestamptz
     where id = ${l.id} and locked_at is null
       and cardinality(array(select t from unnest(codes_sent_at) t where t > ${hourAgo}))
           < ${MAX_CODES_PER_HOUR}
     returning id`;
  if (updated.length === 0) return { ok: false, reason: "rate_limited" };
  return { ok: true, code, phone: l.phone, clinicName: l.clinic_name, patientId: l.patient_id };
}

/** Check a code. Single use; MAX_WRONG_CODES wrong codes (over the link's
 *  life) lock the link for good. */
export async function verifyCode(db: Db, token: string, code: string, now = new Date()): Promise<
  | { ok: true; patientId: string; linkId: string }
  | { ok: false; reason: "invalid" | "expired_code" | "locked" }
  | { ok: false; reason: "wrong_code"; triesLeft: number }
> {
  const l = await findLink(db, token, now);
  if (!l || !l.alive) return { ok: false, reason: "invalid" };
  if (l.locked_at) return { ok: false, reason: "locked" };
  if (l.code_hash && l.code_expires_at && l.code_expires_at <= now) {
    return { ok: false, reason: "expired_code" };
  }
  const given = Buffer.from(sha256(String(code).trim()), "hex");
  if (l.code_hash && timingSafeEqual(given, Buffer.from(l.code_hash, "hex"))) {
    // Consume it — only if it is still the current code and the link is not locked.
    const used = await db`
      update record_links set code_hash = null, code_expires_at = null
       where id = ${l.id} and code_hash = ${l.code_hash} and locked_at is null
       returning id`;
    if (used.length === 1) return { ok: true, patientId: l.patient_id, linkId: l.id };
  }
  const [row] = await db<{ wrong_codes: number; locked_at: Date | null }[]>`
    update record_links
       set wrong_codes = wrong_codes + 1,
           locked_at = case when wrong_codes + 1 >= ${MAX_WRONG_CODES} then ${now}::timestamptz
                            else locked_at end
     where id = ${l.id}
     returning wrong_codes, locked_at`;
  if (row.locked_at) return { ok: false, reason: "locked" };
  return { ok: false, reason: "wrong_code", triesLeft: MAX_WRONG_CODES - row.wrong_codes };
}

/** Whether a verified link is still alive (it may have died since). */
async function liveLink(db: Db, linkId: string, now: Date) {
  const [row] = await db<{ patient_id: string }[]>`
    select l.patient_id
      from record_links l join patients p on p.id = l.patient_id
     where l.id = ${linkId} and l.expires_at > ${now} and l.locked_at is null
       and p.deleted_at is null and p.consent_status <> 'withdrawn'`;
  return row ?? null;
}

export type PatientRecord = {
  clinicName: string; clinicPhone: string | null; timezone: string;
  patientName: string | null; patientPhone: string;
  prescriptions: {
    drugName: string; dosage: string; durationDays: number | null; notes: string | null;
    status: string; doctorName: string; createdAt: Date;
  }[];
};

/** The patient's ACTIVE prescriptions, verbatim, oldest first. Null when the
 *  link is dead. Writes the patient-actor audit row (`action`). */
export async function readRecord(
  db: Db, linkId: string, now = new Date(), action = "read_prescription",
): Promise<PatientRecord | null> {
  const link = await liveLink(db, linkId, now);
  if (!link) return null;
  const [head] = await db<{
    clinic_name: string; clinic_phone: string | null; timezone: string;
    name: string | null; phone: string;
  }[]>`
    select c.name as clinic_name, c.phone as clinic_phone, c.timezone, p.name, p.phone
      from patients p join clinics c on c.id = p.clinic_id
     where p.id = ${link.patient_id}`;
  const rows = await db<{
    drug_name: string; dosage: string; duration_days: number | null; notes: string | null;
    status: string; doctor_name: string; created_at: Date;
  }[]>`
    select r.drug_name, r.dosage, r.duration_days, r.notes, r.status::text as status,
           d.name as doctor_name, r.created_at
      from prescriptions r join doctors d on d.id = r.doctor_id
     where r.patient_id = ${link.patient_id} and r.status = 'active'
     order by r.created_at, r.id`;
  await audit(db, { kind: "patient", id: link.patient_id }, action, "patients", link.patient_id);
  return {
    clinicName: head.clinic_name, clinicPhone: head.clinic_phone, timezone: head.timezone,
    patientName: head.name, patientPhone: head.phone,
    prescriptions: rows.map(r => ({
      drugName: r.drug_name, dosage: r.dosage, durationDays: r.duration_days, notes: r.notes,
      status: r.status, doctorName: r.doctor_name, createdAt: r.created_at,
    })),
  };
}

/** The free-form code message, inside the 24-hour window. No health content. */
export const codeMessage = (clinicName: string, code: string) =>
  `Your code for ${clinicName} is ${code}. It expires in ${CODE_TTL_MINUTES} minutes.`;

type SendDeps = { send?: typeof sendMessage; sendT?: typeof sendTemplate };

/** Issue a code and send it: free-form inside the window, else the
 *  `record_code` authentication template. `sent` is false when the channel
 *  did not deliver (unconfigured, or Meta refused). */
export async function sendRecordCode(
  db: Db, token: string, now = new Date(), deps: SendDeps = {},
): Promise<{ ok: true; sent: boolean } | { ok: false; reason: "invalid" | "rate_limited" }> {
  const issued = await issueCode(db, token, now);
  if (!issued.ok) return issued;
  const send = deps.send ?? sendMessage;
  const sendT = deps.sendT ?? sendTemplate;
  try {
    const { delivered } = await inWindow(db, issued.patientId, now)
      ? await send({ to: issued.phone, text: codeMessage(issued.clinicName, issued.code) })
      : await sendT({ to: issued.phone, name: "record_code", parameters: [issued.code] });
    return { ok: true, sent: delivered };
  } catch (e) {
    console.error("record code send failed", (e as Error).message);
    return { ok: true, sent: false };
  }
}
