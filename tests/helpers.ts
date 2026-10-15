import postgres from "postgres";
import { hashPassword } from "../src/lib/password";

export const TEST_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:devpass@127.0.0.1:55432/clinic_test";

export const AGENT_TEST_URL = TEST_URL.replace(
  /^postgresql:\/\/[^@]+@/,
  `postgresql://clinic_agent:${process.env.AGENT_DB_PASSWORD ?? "devagentpass"}@`,
);

export const db = postgres(TEST_URL, { max: 5, onnotice: () => {} });
export const agentDb = postgres(AGENT_TEST_URL, { max: 3, onnotice: () => {} });

/** Wipe every row but keep the schema — faster and simpler than re-migrating.
 *  NOTE: the suite shares one database, so it must run serially. package.json
 *  passes --test-concurrency=1; without it the per-file worker processes
 *  truncate each other's fixtures mid-test. */
export async function reset() {
  // a test-only trigger left behind by a crashed run would swallow every cancel
  await db.unsafe(`drop trigger if exists test_swallow_cancel on appointments`);
  await db.unsafe(`drop function if exists test_swallow_cancel()`);
  await db`truncate
    -- failed-login rows are test state like any other and must not survive a reset
    login_attempts,
    patient_notes, tasks,
    audit_log, consent_log, messages, conversations, escalations,
    reminders, prescriptions, appointments, patients, staff_users, doctors, clinics
    restart identity cascade`;
}

export type Fixture = Awaited<ReturnType<typeof seed>>;

/** One clinic, one doctor, one consenting patient — the minimum any booking test needs. */
export async function seed(opts: { consent?: "granted" | "pending" } = {}) {
  const [clinic] = await db<{ id: string }[]>`
    insert into clinics (name, timezone, phone)
    values ('Test Clinic', 'Asia/Kolkata', '+911140000000') returning id`;
  const [doctor] = await db<{ id: string }[]>`
    insert into doctors (clinic_id, name, specialty, default_slot_minutes)
    values (${clinic.id}, 'Dr. Rao', 'General', 30) returning id`;
  const [doctorUser] = await db<{ id: string }[]>`
    insert into staff_users (clinic_id, name, email, password_hash, role, doctor_id)
    values (${clinic.id}, 'Dr. Rao', 'rao@test.clinic',
            ${await hashPassword("correct horse")}, 'doctor', ${doctor.id})
    returning id`;
  const [reception] = await db<{ id: string }[]>`
    insert into staff_users (clinic_id, name, email, password_hash, role)
    values (${clinic.id}, 'Front Desk', 'desk@test.clinic',
            ${await hashPassword("correct horse")}, 'receptionist')
    returning id`;
  const consent = opts.consent ?? "granted";
  const [patient] = await db<{ id: string }[]>`
    insert into patients (clinic_id, name, phone, consent_status, consent_recorded_at)
    values (${clinic.id}, 'Asha', '+919000000001', ${consent}::consent_status,
            ${consent === "granted" ? new Date() : null})
    returning id`;
  const [other] = await db<{ id: string }[]>`
    insert into patients (clinic_id, name, phone, consent_status, consent_recorded_at)
    values (${clinic.id}, 'Bilal', '+919000000002', 'granted', now()) returning id`;
  const [conversation] = await db<{ id: string }[]>`
    insert into conversations (patient_id) values (${patient.id}) returning id`;

  // A second clinic, so every isolation test has something to fail against.
  const [otherClinic] = await db<{ id: string }[]>`
    insert into clinics (name, timezone, phone)
    values ('Rival Clinic', 'Asia/Kolkata', '+911140000099') returning id`;
  const [otherDoctor] = await db<{ id: string }[]>`
    insert into doctors (clinic_id, name, specialty, default_slot_minutes)
    values (${otherClinic.id}, 'Dr. Khan', 'General', 30) returning id`;
  const [otherStaff] = await db<{ id: string }[]>`
    insert into staff_users (clinic_id, name, email, password_hash, role)
    values (${otherClinic.id}, 'Rival Desk', 'desk@rival.clinic',
            ${await hashPassword("correct horse")}, 'receptionist')
    returning id`;
  const [otherClinicPatient] = await db<{ id: string }[]>`
    insert into patients (clinic_id, name, phone, consent_status, consent_recorded_at)
    values (${otherClinic.id}, 'Chetan', '+919000000003', 'granted', now()) returning id`;
  const [otherConversation] = await db<{ id: string }[]>`
    insert into conversations (patient_id) values (${otherClinicPatient.id}) returning id`;

  return {
    clinicId: clinic.id, doctorId: doctor.id, doctorUserId: doctorUser.id,
    receptionistId: reception.id, patientId: patient.id, otherPatientId: other.id,
    conversationId: conversation.id,
    otherClinicId: otherClinic.id, otherDoctorId: otherDoctor.id,
    otherStaffId: otherStaff.id, otherClinicPatientId: otherClinicPatient.id,
    otherConversationId: otherConversation.id,
  };
}

/** A future instant inside clinic hours, expressed in IST. */
export function futureSlot(hourIST = 10, daysAhead = 3): Date {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  const day = d.toISOString().slice(0, 10);
  // 09:00 IST == 03:30 UTC; build the instant directly to avoid host-timezone drift.
  const at = new Date(`${day}T${String(hourIST).padStart(2, "0")}:00:00+05:30`);
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", weekday: "short",
  }).format(at);
  return weekday === "Sun" ? new Date(at.getTime() + 86_400_000) : at;
}

export const localDay = (at: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(at);

export async function closeAll() {
  await db.end();
  await agentDb.end();
}
