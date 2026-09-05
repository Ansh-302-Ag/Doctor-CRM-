# Phase 2 + Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the product the doc set describes — doctors record prescriptions in the CRM, patients get reminders that are safe to send, staff can find and manage patients — and close the security gaps a full code review found.

**Architecture:** Everything stays inside the one Next.js app. New business logic goes in `src/lib/` as plain functions taking a `Db` handle, exactly like `booking.ts` and `consent.ts`; CRM pages and server actions call those functions and never write their own SQL. The reminder sender is a route handler driven by an external scheduler, not an in-process timer, because the app runs serverless. The agent gains no new write powers.

**Tech Stack:** TypeScript, Next.js 16 (App Router, server actions), Postgres via `postgres` (tagged templates, no ORM), numbered SQL migrations, `node:test` via `tsx`, Anthropic Messages API, WhatsApp Business Cloud API.

**Spec:** `docs/00-README.md` through `docs/08-security-and-error-handling.md`. `docs/09-implementation-log.md` records current state. Read `docs/01` (scope), `docs/02` (DPDP), `docs/07` (roadmap) and `docs/08` (security bar) before starting.

## Global Constraints

Copied from the spec. Every task's requirements implicitly include these.

- **The AI never makes a clinical decision.** No new tool may answer, interpret, or advise on anything clinical. (`docs/01`)
- **Ambiguity resolves toward the human, always.** (`docs/01`)
- **`screen()` runs before any model, on every path, and cannot be overridden.** (`docs/01`, `docs/05`)
- **The agent never writes to `prescriptions`.** Enforced in `rbac.ts` *and* `db/002_agent_role.sql`. Both must keep holding. (`docs/08`)
- **Two enforcement layers for every risky action** — application and database. (`docs/08`)
- **Data minimisation:** every new column justifiable in one sentence. (`docs/00` principle 4, `docs/02`)
- **Audit every read/write of patient or prescription data**, with actor. (`docs/02`, `docs/08`)
- **Tests before implementation** for anything touching booking, patient data, or reminders. (`docs/00` principle 3)
- **Nothing is "done" until it has been run.** (`docs/00` principle 3)
- **Ponytail:** smallest thing that works; log deferrals instead of building them. (`docs/00` principle 2)
- Timestamps are `timestamptz`, always UTC. IDs are `uuid`. (`docs/04`)
- Postgres roles are cluster-global: `AGENT_DB_PASSWORD` must be set for any migration run.
- Test suite runs with `--test-concurrency=1` (shared database).
- Migrations are append-only numbered files in `db/`; the next free number is `006`.

## Existing Interfaces You Will Use

These already exist. Signatures are exact — do not guess.

```ts
// src/lib/db.ts
export const sql: Pool;                    // app role, full privileges
export const agentSql: Db;                 // restricted clinic_agent role
export type Db = Sql<{}> | TransactionSql<{}>;
export type Pool = Sql<{}>;

// src/lib/audit.ts
export type Actor = { kind: "staff"; id: string } | { kind: "agent" };
export async function audit(db: Db, actor: Actor, action: string,
                            targetTable: string, targetId: string | null): Promise<void>;

// src/lib/rbac.ts
export type Role = "doctor" | "receptionist" | "admin" | "agent";
export type Permission = "patients:read" | "appointments:read" | "appointments:write"
  | "prescriptions:read" | "prescriptions:write"
  | "escalations:read" | "escalations:create" | "escalations:resolve";
export function requirePermission(role: Role, p: Permission): void;  // throws Forbidden
export function can(role: Role, p: Permission): boolean;

// src/lib/session.ts
export const currentStaff: () => Promise<{ id: string; clinicId: string; name: string; role: Role }>;

// src/lib/channel.ts
export async function sendMessage(msg: { to: string; text: string }): Promise<{ delivered: boolean }>;
export const mask: (phone: string) => string;
export async function notifyStaff(text: string): Promise<void>;

// src/lib/consent.ts
export async function assertConsent(db: Db, patientId: string): Promise<void>;

// src/lib/escalations.ts
export async function listEscalations(db: Db, actor: Actor, clinicId: string): Promise<...>;
export class NotFound extends Error {}
export async function acknowledgeEscalation(db, actor, role, clinicId, id, staffId): Promise<void>;
export async function resolveEscalation(db, actor, role, clinicId, id): Promise<void>;

// tests/helpers.ts
export const db: Pool;        // TEST_DATABASE_URL, app role
export const agentDb: Pool;   // TEST_DATABASE_URL, clinic_agent role
export async function reset(): Promise<void>;
export async function seed(opts?: { consent?: "granted" | "pending" }): Promise<{
  clinicId: string; doctorId: string; doctorUserId: string; receptionistId: string;
  patientId: string; otherPatientId: string; conversationId: string;
}>;
export function futureSlot(hourIST?: number, daysAhead?: number): Date;
export const localDay: (at: Date) => string;
export async function closeAll(): Promise<void>;
```

## File Structure

**New files**

| Path | Responsibility |
|---|---|
| `db/006_reminders_and_templates.sql` | `reminders.template_name`, `reminders.last_error`, dedupe index, agent grant |
| `db/007_login_throttle.sql` | `login_attempts` table |
| `src/lib/prescriptions.ts` | Create/list/discontinue prescriptions. The only module that writes that table. |
| `src/lib/reminders.ts` | Schedule, cancel, and send reminders. Re-checks state at send time. |
| `src/lib/templates.ts` | WhatsApp template text and parameter building, in one place |
| `src/lib/patients.ts` | Patient lookup, search, name capture |
| `src/lib/throttle.ts` | Login attempt recording and lockout |
| `src/app/(crm)/patients/page.tsx` | Patient list + search |
| `src/app/(crm)/patients/[id]/page.tsx` | One patient: appointments, prescriptions, entry form |
| `src/app/api/cron/reminders/route.ts` | Sends due reminders |
| `src/app/api/cron/purge/route.ts` | Hard-deletes patients past the retention window |
| `docs/runbooks/breach.md` | The DPDP breach runbook `docs/02` requires |
| `docs/10-whatsapp-templates.md` | Exact template text submitted to Meta, with approval status |
| `tests/prescriptions.test.ts` `tests/reminders.test.ts` `tests/templates.test.ts` `tests/patients.test.ts` `tests/throttle.test.ts` `tests/intent.test.ts` `tests/multi-clinic.test.ts` `tests/consent-purge.test.ts` `tests/load.test.ts` | Coverage for each of the above |

**Modified files**

| Path | Change |
|---|---|
| `src/lib/channel.ts` | Add `sendTemplate()`; keep `sendMessage()` for in-window replies |
| `src/lib/booking.ts` | Schedule a reminder on booking; cancel via `cancelReminders` |
| `src/lib/agent/index.ts` | Capture the patient's name; restore the reminder promise |
| `src/lib/agent/intent.ts` | Add the `provide_name` intent and a `name` field |
| `src/lib/auth.ts` | Consult the throttle before verifying |
| `src/lib/consent.ts` | Add `purgeDeletedPatients` |
| `tests/helpers.ts` | `seed()` gains a second clinic for isolation tests |
| `docs/09-implementation-log.md`, `README.md`, `docs/07-mvp-roadmap.md` | Kept true |

---

## Task 1: Prescription records (doctors write, the agent cannot)

Phase 2's first half. `docs/07` calls this the first real test of the "agent never writes prescriptions" rule.

**Files:**
- Create: `src/lib/prescriptions.ts`
- Test: `tests/prescriptions.test.ts`

**Interfaces:**
- Consumes: `Db`, `Actor`, `Role`, `requirePermission`, `audit`
- Produces:
```ts
export type PrescriptionInput = {
  patientId: string; doctorId: string; appointmentId?: string;
  drugName: string; dosage: string; durationDays?: number; notes?: string;
};
export type Prescription = {
  id: string; drug_name: string; dosage: string; duration_days: number | null;
  notes: string | null; status: "active" | "completed" | "discontinued";
  created_at: Date; doctor_name: string; created_by_name: string;
};
export class InvalidPrescription extends Error { field: string }
export async function createPrescription(
  db: Db, actor: { kind: "staff"; id: string }, role: Role, input: PrescriptionInput,
): Promise<{ id: string }>;
export async function listPrescriptions(
  db: Db, actor: Actor, role: Role, patientId: string,
): Promise<Prescription[]>;
export async function discontinuePrescription(
  db: Db, actor: { kind: "staff"; id: string }, role: Role, id: string,
): Promise<void>;
```

- [ ] **Step 1: Write the failing tests**

Create `tests/prescriptions.test.ts`:

```ts
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, agentDb, reset, seed, closeAll, type Fixture } from "./helpers";
import {
  createPrescription, listPrescriptions, discontinuePrescription, InvalidPrescription,
} from "../src/lib/prescriptions";
import { Forbidden } from "../src/lib/rbac";

let f: Fixture;
beforeEach(async () => { await reset(); f = await seed(); });
after(closeAll);

const input = () => ({
  patientId: f.patientId, doctorId: f.doctorId,
  drugName: "Amoxicillin", dosage: "500mg twice daily", durationDays: 5,
});
const DOCTOR = () => ({ kind: "staff" as const, id: f.doctorUserId });

test("a doctor can record a prescription exactly as entered", async () => {
  const { id } = await createPrescription(db, DOCTOR(), "doctor", input());
  const [row] = await db<{ drug_name: string; dosage: string; duration_days: number;
                          status: string; created_by: string }[]>`
    select drug_name, dosage, duration_days, status, created_by from prescriptions where id = ${id}`;
  assert.equal(row.drug_name, "Amoxicillin");
  assert.equal(row.dosage, "500mg twice daily");
  assert.equal(row.duration_days, 5);
  assert.equal(row.status, "active");
  assert.equal(row.created_by, f.doctorUserId);
});

test("a receptionist cannot write a prescription", async () => {
  await assert.rejects(
    createPrescription(db, { kind: "staff", id: f.receptionistId }, "receptionist", input()),
    Forbidden,
  );
  assert.equal((await db`select id from prescriptions`).length, 0);
});

test("the agent cannot write a prescription, at either layer", async () => {
  await assert.rejects(
    // @ts-expect-error - the agent is deliberately not a valid actor here
    createPrescription(db, { kind: "agent" }, "agent", input()),
  );
  await assert.rejects(
    agentDb`insert into prescriptions (patient_id, doctor_id, drug_name, dosage, created_by)
            values (${f.patientId}, ${f.doctorId}, 'X', 'Y', ${f.doctorUserId})`,
    (e: { code?: string }) => e.code === "42501",
  );
});

test("empty drug name or dosage is refused before it reaches the record", async () => {
  for (const bad of [
    { ...input(), drugName: "" },
    { ...input(), drugName: "   " },
    { ...input(), dosage: "" },
    { ...input(), durationDays: 0 },
    { ...input(), durationDays: -3 },
  ]) {
    await assert.rejects(createPrescription(db, DOCTOR(), "doctor", bad), InvalidPrescription);
  }
  assert.equal((await db`select id from prescriptions`).length, 0);
});

test("listing returns newest first with the prescribing doctor's name", async () => {
  await createPrescription(db, DOCTOR(), "doctor", input());
  await createPrescription(db, DOCTOR(), "doctor",
    { ...input(), drugName: "Paracetamol", dosage: "650mg as needed" });

  const rows = await listPrescriptions(db, DOCTOR(), "doctor", f.patientId);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].drug_name, "Paracetamol");
  assert.equal(rows[0].doctor_name, "Dr. Rao");
});

test("discontinuing changes status and leaves the record intact", async () => {
  const { id } = await createPrescription(db, DOCTOR(), "doctor", input());
  await discontinuePrescription(db, DOCTOR(), "doctor", id);

  const [row] = await db<{ status: string; drug_name: string }[]>`
    select status, drug_name from prescriptions where id = ${id}`;
  assert.equal(row.status, "discontinued");
  assert.equal(row.drug_name, "Amoxicillin", "the record is history, never erased");
});

test("every prescription read and write is audited", async () => {
  await createPrescription(db, DOCTOR(), "doctor", input());
  await listPrescriptions(db, { kind: "staff", id: f.receptionistId }, "receptionist", f.patientId);

  const rows = await db<{ actor: string; action: string }[]>`
    select actor, action from audit_log order by created_at`;
  const actions = [...rows].map(r => r.action);
  assert.ok(actions.includes("create_prescription"), actions.join(","));
  assert.ok(actions.includes("read_prescriptions"), actions.join(","));
  assert.ok([...rows].some(r => r.actor === f.receptionistId));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx tsx --test --test-concurrency=1 --env-file=.env.local tests/prescriptions.test.ts
```

Expected: FAIL — `Cannot find module '../src/lib/prescriptions'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/prescriptions.ts`:

```ts
/**
 * Prescription records. This module is the only thing that writes the table.
 *
 * A prescription here is a RECORD of what the doctor decided, never a
 * recommendation and never something the system reasons about (docs/01). It is
 * stored exactly as entered and read back verbatim.
 */
import type { Db } from "./db";
import { audit, type Actor } from "./audit";
import { requirePermission, type Role } from "./rbac";

export type PrescriptionInput = {
  patientId: string; doctorId: string; appointmentId?: string;
  drugName: string; dosage: string; durationDays?: number; notes?: string;
};

export type Prescription = {
  id: string; drug_name: string; dosage: string; duration_days: number | null;
  notes: string | null; status: "active" | "completed" | "discontinued";
  created_at: Date; doctor_name: string; created_by_name: string;
};

export class InvalidPrescription extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = "InvalidPrescription";
  }
}

/** Validate at the trust boundary: this is typed by a human in a hurry. */
function validate(input: PrescriptionInput) {
  const drugName = input.drugName?.trim();
  const dosage = input.dosage?.trim();
  if (!drugName) throw new InvalidPrescription("drugName", "a drug name is required");
  if (!dosage) throw new InvalidPrescription("dosage", "a dosage is required");
  if (input.durationDays !== undefined && input.durationDays !== null &&
      (!Number.isInteger(input.durationDays) || input.durationDays < 1)) {
    throw new InvalidPrescription("durationDays", "duration must be a whole number of days");
  }
  return { ...input, drugName, dosage, notes: input.notes?.trim() || undefined };
}

export async function createPrescription(
  db: Db, actor: { kind: "staff"; id: string }, role: Role, raw: PrescriptionInput,
): Promise<{ id: string }> {
  requirePermission(role, "prescriptions:write");
  const input = validate(raw);

  const [row] = await db<{ id: string }[]>`
    insert into prescriptions
      (patient_id, doctor_id, appointment_id, drug_name, dosage, duration_days, notes, created_by)
    values
      (${input.patientId}, ${input.doctorId}, ${input.appointmentId ?? null},
       ${input.drugName}, ${input.dosage}, ${input.durationDays ?? null},
       ${input.notes ?? null}, ${actor.id})
    returning id`;

  await audit(db, actor, "create_prescription", "prescriptions", row.id);
  return row;
}

export async function listPrescriptions(
  db: Db, actor: Actor, role: Role, patientId: string,
): Promise<Prescription[]> {
  requirePermission(role, "prescriptions:read");
  const rows = await db<Prescription[]>`
    select p.id, p.drug_name, p.dosage, p.duration_days, p.notes, p.status, p.created_at,
           d.name as doctor_name, s.name as created_by_name
      from prescriptions p
      join doctors d     on d.id = p.doctor_id
      join staff_users s on s.id = p.created_by
     where p.patient_id = ${patientId}
     order by p.created_at desc`;
  await audit(db, actor, "read_prescriptions", "patients", patientId);
  return rows;
}

export async function discontinuePrescription(
  db: Db, actor: { kind: "staff"; id: string }, role: Role, id: string,
): Promise<void> {
  requirePermission(role, "prescriptions:write");
  await db`update prescriptions set status = 'discontinued' where id = ${id}`;
  await audit(db, actor, "discontinue_prescription", "prescriptions", id);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx tsx --test --test-concurrency=1 --env-file=.env.local tests/prescriptions.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/prescriptions.ts tests/prescriptions.test.ts
git commit -m "feat: prescription records, writable by doctors only"
```

---

## Task 2: Patient records, search, and name capture

The calendar shows "—" for every patient because nothing ever asks a name, and staff have no way to find a patient.

**Files:**
- Create: `src/lib/patients.ts`
- Test: `tests/patients.test.ts`
- Modify: `tests/helpers.ts` (add a second clinic to `seed()`)

**Interfaces:**
- Produces:
```ts
export type PatientSummary = {
  id: string; name: string | null; phone: string;
  consent_status: "pending" | "granted" | "withdrawn";
  next_appointment: Date | null; active_prescriptions: number;
};
export async function searchPatients(
  db: Db, actor: Actor, role: Role, clinicId: string, query: string,
): Promise<PatientSummary[]>;
export async function getPatient(
  db: Db, actor: Actor, role: Role, clinicId: string, patientId: string,
): Promise<PatientSummary | null>;
export async function setPatientName(
  db: Db, actor: Actor, patientId: string, name: string,
): Promise<void>;
```

- [ ] **Step 1: Extend the test fixture with a second clinic**

In `tests/helpers.ts`, inside `seed()`, immediately before the `return`, add:

```ts
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
```

and extend the returned object with:

```ts
    otherClinicId: otherClinic.id, otherDoctorId: otherDoctor.id,
    otherStaffId: otherStaff.id, otherClinicPatientId: otherClinicPatient.id,
    otherConversationId: otherConversation.id,
```

- [ ] **Step 2: Write the failing tests**

Create `tests/patients.test.ts`:

```ts
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, reset, seed, closeAll, futureSlot, type Fixture } from "./helpers";
import { searchPatients, getPatient, setPatientName } from "../src/lib/patients";
import { createPrescription } from "../src/lib/prescriptions";
import { bookAppointment } from "../src/lib/booking";

let f: Fixture;
const STAFF = () => ({ kind: "staff" as const, id: f.receptionistId });

beforeEach(async () => { await reset(); f = await seed(); });
after(closeAll);

test("search finds a patient by name or by phone", async () => {
  const byName = await searchPatients(db, STAFF(), "receptionist", f.clinicId, "asha");
  assert.equal(byName.length, 1);
  assert.equal(byName[0].id, f.patientId);

  const byPhone = await searchPatients(db, STAFF(), "receptionist", f.clinicId, "9000000002");
  assert.equal(byPhone.length, 1);
  assert.equal(byPhone[0].id, f.otherPatientId);
});

test("an empty query lists the clinic's patients", async () => {
  assert.equal((await searchPatients(db, STAFF(), "receptionist", f.clinicId, "")).length, 2);
});

test("search never returns another clinic's patients", async () => {
  assert.equal((await searchPatients(db, STAFF(), "receptionist", f.clinicId, "chetan")).length, 0);
  assert.equal(await getPatient(db, STAFF(), "receptionist", f.clinicId, f.otherClinicPatientId), null);
});

test("search excludes patients who asked to be deleted", async () => {
  await db`update patients set deleted_at = now() where id = ${f.patientId}`;
  assert.equal((await searchPatients(db, STAFF(), "receptionist", f.clinicId, "asha")).length, 0);
});

test("the summary carries the next appointment and active prescription count", async () => {
  await bookAppointment(db, STAFF(), "receptionist",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(10) });
  await createPrescription(db, { kind: "staff", id: f.doctorUserId }, "doctor", {
    patientId: f.patientId, doctorId: f.doctorId,
    drugName: "Amoxicillin", dosage: "500mg twice daily",
  });

  const p = await getPatient(db, STAFF(), "receptionist", f.clinicId, f.patientId);
  assert.ok(p);
  assert.ok(p.next_appointment);
  assert.equal(Number(p.active_prescriptions), 1);
});

test("a name can be captured and is trimmed", async () => {
  await setPatientName(db, { kind: "agent" }, f.otherPatientId, "  Bilal Ahmed  ");
  const [row] = await db<{ name: string }[]>`select name from patients where id = ${f.otherPatientId}`;
  assert.equal(row.name, "Bilal Ahmed");
});

test("a blank name never overwrites a real one", async () => {
  await setPatientName(db, { kind: "agent" }, f.patientId, "   ");
  const [row] = await db<{ name: string }[]>`select name from patients where id = ${f.patientId}`;
  assert.equal(row.name, "Asha");
});

test("reading a patient record writes an audit row", async () => {
  await getPatient(db, STAFF(), "receptionist", f.clinicId, f.patientId);
  const rows = await db<{ action: string }[]>`
    select action from audit_log where target_id = ${f.patientId}`;
  assert.ok([...rows].some(r => r.action === "read_patient"));
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx tsx --test --test-concurrency=1 --env-file=.env.local tests/patients.test.ts
```

Expected: FAIL — `Cannot find module '../src/lib/patients'`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/patients.ts`:

```ts
/**
 * Patient lookup for the CRM.
 *
 * Every query is scoped by clinic and excludes soft-deleted patients — an id
 * arriving from a URL is not proof of anything (docs/08).
 */
import type { Db } from "./db";
import { audit, type Actor } from "./audit";
import { requirePermission, type Role } from "./rbac";

export type PatientSummary = {
  id: string; name: string | null; phone: string;
  consent_status: "pending" | "granted" | "withdrawn";
  next_appointment: Date | null; active_prescriptions: number;
};

export async function searchPatients(
  db: Db, actor: Actor, role: Role, clinicId: string, query: string,
): Promise<PatientSummary[]> {
  requirePermission(role, "patients:read");
  const q = query.trim();
  const like = `%${q}%`;

  const rows = await db<PatientSummary[]>`
    select p.id, p.name, p.phone, p.consent_status,
           (select min(a.starts_at) from appointments a
             where a.patient_id = p.id and a.status = 'booked' and a.starts_at > now()
           ) as next_appointment,
           (select count(*) from prescriptions r
             where r.patient_id = p.id and r.status = 'active'
           ) as active_prescriptions
      from patients p
     where p.clinic_id = ${clinicId} and p.deleted_at is null
       and (${q === ""} or p.name ilike ${like} or p.phone ilike ${like})
     order by p.name nulls last, p.created_at desc
     limit 100`;

  await audit(db, actor, "search_patients", "patients", null);
  return rows;
}

export async function getPatient(
  db: Db, actor: Actor, role: Role, clinicId: string, patientId: string,
): Promise<PatientSummary | null> {
  requirePermission(role, "patients:read");
  const [row] = await db<PatientSummary[]>`
    select p.id, p.name, p.phone, p.consent_status,
           (select min(a.starts_at) from appointments a
             where a.patient_id = p.id and a.status = 'booked' and a.starts_at > now()
           ) as next_appointment,
           (select count(*) from prescriptions r
             where r.patient_id = p.id and r.status = 'active'
           ) as active_prescriptions
      from patients p
     where p.id = ${patientId} and p.clinic_id = ${clinicId} and p.deleted_at is null`;
  if (!row) return null;
  await audit(db, actor, "read_patient", "patients", patientId);
  return row;
}

/** Record a name the patient gave us. Never blanks out one we already have. */
export async function setPatientName(
  db: Db, actor: Actor, patientId: string, name: string,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  await db`update patients set name = ${trimmed} where id = ${patientId}`;
  await audit(db, actor, "set_patient_name", "patients", patientId);
}
```

- [ ] **Step 5: Run the tests to verify they pass, then commit**

```bash
npx tsx --test --test-concurrency=1 --env-file=.env.local tests/patients.test.ts
npx tsc --noEmit
git add src/lib/patients.ts tests/patients.test.ts tests/helpers.ts
git commit -m "feat: patient search and name capture, clinic-scoped"
```

Expected: PASS, 8 tests.

---

## Task 3: The agent asks for and records the patient's name

**Files:**
- Modify: `src/lib/agent/intent.ts`, `src/lib/agent/index.ts`, `tests/stub-classifier.ts`
- Test: `tests/agent.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/agent.test.ts`:

```ts
test("a patient with no name on file is asked for one before booking", async () => {
  const p = "+919000000088";
  const ask = (body: string, id: string, over: Record<string, unknown> = {}) =>
    handleInbound(db, { clinicId: f.clinicId, phone: p, body, providerMessageId: id },
      new Date(), async (i) => ({ ...(await scripted(i)), ...over }));

  assert.match((await ask("I need an appointment", "n1"))!.text, /store your name/i);
  assert.match((await ask("yes", "n2"))!.text, /name/i);

  const named = await ask("Asha Verma", "n3", { intent: "provide_name", name: "Asha Verma" });
  assert.match(named!.text, /what day/i);

  const [row] = await db<{ name: string }[]>`select name from patients where phone = ${p}`;
  assert.equal(row.name, "Asha Verma");
});

test("a patient who already has a name is never asked again", async () => {
  const r = await say("I need an appointment with Dr. Rao");
  assert.doesNotMatch(r!.text, /what name/i);
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
npx tsx --test --test-concurrency=1 --env-file=.env.local tests/agent.test.ts
```

Expected: FAIL — the first test gets a day prompt where it expects a name prompt.

- [ ] **Step 3: Add `provide_name` to the classifier**

In `src/lib/agent/intent.ts`:

1. Add `"provide_name"` to the `INTENTS` array and to the tool schema's `intent` enum.
2. Extend the enum description with: `"provide_name: the message is the patient telling us their name. "`
3. Add to `input_schema.properties`:

```ts
      name: {
        type: ["string", "null"],
        description: "The patient's own name, if this message states it. Null otherwise.",
      },
```

4. Add `"name"` to `required`, and `name: string | null` to the `Classification` type.
5. In the sanitisation block add, and include `name` in the returned object:

```ts
  const name = typeof raw.name === "string" && raw.name.trim().length > 0 &&
    raw.name.trim().length <= 80 ? raw.name.trim() : null;
```

- [ ] **Step 4: Add the name step to the state machine**

In `src/lib/agent/index.ts`:

1. `import { setPatientName } from "../patients";`
2. Extend `Ctx["patient"]` with `name: string | null`, and select `name` in `context()`.
3. In `route()`, immediately after the consent gate and before the logistics switch:

```ts
  // A booking with no name attached is not much use to the front desk, so ask
  // once, right after consent. Anything else — reading back an appointment,
  // cancelling — proceeds without it.
  if (!ctx.patient.name && c.intent === "provide_name" && c.name) {
    await setPatientName(db, { kind: "agent" }, ctx.patient.id, c.name);
    const stashed = isPending(state) ? state.pending : null;
    await clearState(db, ctx.conversation.id);
    if (!stashed) {
      return { text: `Thank you, ${c.name}. What day would you like to come in?`,
               escalated: false, intent: c.intent };
    }
    const resumed = await route(
      db, { ...msg, body: stashed },
      { ...ctx, patient: { ...ctx.patient, name: c.name },
        conversation: { ...ctx.conversation, state: {} } },
      now, classify,
    );
    return { ...resumed, text: `Thank you, ${c.name}. ${resumed.text}` };
  }

  if (!ctx.patient.name && (c.intent === "book" || c.intent === "reschedule")) {
    await setState(db, ctx.conversation.id, { pending: msg.body });
    return { text: "Before I book that — what name should I put on the appointment?",
             escalated: false, intent: "name_requested" };
  }
```

- [ ] **Step 5: Teach the stub classifier about names**

In `tests/stub-classifier.ts`, include `name: null` in the `Classification` returned by
`stub()` and by `scripted` — real name detection is the model's job, and the tests that
need it pass it explicitly.

- [ ] **Step 6: Run the whole suite and commit**

```bash
npx tsx --test --test-concurrency=1 --env-file=.env.local "tests/*.test.ts"
npx tsc --noEmit
git add src/lib/agent tests/agent.test.ts tests/stub-classifier.ts
git commit -m "feat: agent asks for and records the patient's name"
```

Expected: PASS.

---

## Task 4: WhatsApp message templates

Reminders are business-initiated, so WhatsApp requires a pre-approved template and a different send shape. Nothing about reminders can ship without this.

**Files:**
- Create: `src/lib/templates.ts`, `docs/10-whatsapp-templates.md`
- Modify: `src/lib/channel.ts`
- Test: `tests/templates.test.ts`

**Interfaces:**
- Produces:
```ts
export type TemplateName = "appointment_reminder" | "refill_followup";
export type TemplateSpec = { name: TemplateName; language: string; bodyText: string; params: string[] };
export const TEMPLATES: Record<TemplateName, TemplateSpec>;
export class MissingTemplateParameter extends Error { param: string }
export function renderTemplate(name: TemplateName, params: Record<string, string>): {
  name: TemplateName; language: string; parameters: string[]; preview: string;
};
// channel.ts
export async function sendTemplate(msg: {
  to: string; name: TemplateName; parameters: string[];
}): Promise<{ delivered: boolean }>;
```

- [ ] **Step 1: Write the failing tests**

Create `tests/templates.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { TEMPLATES, renderTemplate, MissingTemplateParameter } from "../src/lib/templates";

test("every template's parameter list matches its body placeholders", () => {
  for (const spec of Object.values(TEMPLATES)) {
    const placeholders = [...spec.bodyText.matchAll(/\{\{(\d+)\}\}/g)].map(m => Number(m[1]));
    assert.deepEqual(placeholders, placeholders.map((_, i) => i + 1),
      `${spec.name}: placeholders must be {{1}}..{{n}} in order`);
    assert.equal(placeholders.length, spec.params.length,
      `${spec.name}: ${placeholders.length} placeholders but ${spec.params.length} named params`);
  }
});

test("rendering substitutes parameters in the declared order", () => {
  const r = renderTemplate("appointment_reminder", {
    clinic_name: "Sunrise Clinic", doctor_name: "Dr. Rao", appointment_time: "Fri 4 Sept, 10:00 am",
  });
  assert.deepEqual(r.parameters, ["Sunrise Clinic", "Dr. Rao", "Fri 4 Sept, 10:00 am"]);
  assert.match(r.preview, /Sunrise Clinic/);
  assert.doesNotMatch(r.preview, /\{\{/);
});

test("a missing parameter is refused rather than sent as a gap", () => {
  assert.throws(
    () => renderTemplate("appointment_reminder", { clinic_name: "Sunrise Clinic" }),
    MissingTemplateParameter,
  );
});

test("no template contains clinical language", () => {
  // docs/01: a reminder tells someone about a logistics event. It never advises.
  const banned = /\b(dose|dosage|take|should|symptom|treat|cure|diagnos|safe|healthy)\b/i;
  for (const spec of Object.values(TEMPLATES)) {
    assert.doesNotMatch(spec.bodyText, banned, `${spec.name} contains clinical language`);
  }
});

test("the refill template names the drug but says nothing about taking it", () => {
  const r = renderTemplate("refill_followup", {
    clinic_name: "Sunrise Clinic", drug_name: "Amoxicillin",
  });
  assert.match(r.preview, /Amoxicillin/);
  assert.match(r.preview, /clinic/i);
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
npx tsx --test --test-concurrency=1 --env-file=.env.local tests/templates.test.ts
```

Expected: FAIL — `Cannot find module '../src/lib/templates'`.

- [ ] **Step 3: Write the template definitions**

Create `src/lib/templates.ts`:

```ts
/**
 * WhatsApp message templates.
 *
 * WhatsApp only allows free-form text within 24 hours of the patient's last
 * message. Anything we initiate — a reminder — must use a template approved by
 * Meta in advance. The approved text and this file must agree exactly, so the
 * text lives here once and docs/10-whatsapp-templates.md records what was sent
 * for approval.
 *
 * Templates never carry clinical content (docs/01). A reminder says an event is
 * coming up; it does not tell anyone what to do about their health.
 */
export type TemplateName = "appointment_reminder" | "refill_followup";

export type TemplateSpec = {
  name: TemplateName;
  language: string;
  /** Exactly the body submitted to Meta, with {{1}}-style placeholders. */
  bodyText: string;
  /** Names for those placeholders, in order. */
  params: string[];
};

export const TEMPLATES: Record<TemplateName, TemplateSpec> = {
  appointment_reminder: {
    name: "appointment_reminder",
    language: "en",
    bodyText:
      "Reminder from {{1}}: you have an appointment with {{2}} on {{3}}. " +
      "Reply CANCEL if you can no longer make it.",
    params: ["clinic_name", "doctor_name", "appointment_time"],
  },
  refill_followup: {
    name: "refill_followup",
    language: "en",
    bodyText:
      "A note from {{1}}: the course of {{2}} on your record is ending. " +
      "Reply BOOK to arrange a follow-up, or call the clinic.",
    params: ["clinic_name", "drug_name"],
  },
};

export class MissingTemplateParameter extends Error {
  constructor(public param: string, templateName: string) {
    super(`template '${templateName}' requires a '${param}' parameter`);
    this.name = "MissingTemplateParameter";
  }
}

export function renderTemplate(name: TemplateName, params: Record<string, string>) {
  const spec = TEMPLATES[name];
  const parameters = spec.params.map(p => {
    const value = params[p];
    if (value === undefined || value === null || value === "") {
      throw new MissingTemplateParameter(p, name);
    }
    return value;
  });
  const preview = parameters.reduce(
    (text, value, i) => text.replaceAll(`{{${i + 1}}}`, value), spec.bodyText);
  return { name, language: spec.language, parameters, preview };
}
```

- [ ] **Step 4: Add the template send path to the channel**

At the top of `src/lib/channel.ts` add:

```ts
import { TEMPLATES, type TemplateName } from "./templates";
```

and append:

```ts
/**
 * Send a pre-approved template. This is the ONLY way to message a patient
 * outside the 24-hour window WhatsApp allows after their last message, so every
 * reminder goes through here — never through sendMessage.
 */
export async function sendTemplate(msg: {
  to: string; name: TemplateName; parameters: string[];
}): Promise<{ delivered: boolean }> {
  const spec = TEMPLATES[msg.name];
  if (msg.parameters.length !== spec.params.length) {
    throw new Error(
      `template '${msg.name}' needs ${spec.params.length} parameters, got ${msg.parameters.length}`);
  }
  if (!configured()) {
    console.log(`[channel:simulated template] -> ${mask(msg.to)} (${msg.name})`);
    return { delivered: false };
  }

  const res = await fetch(
    `https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: msg.to,
        type: "template",
        template: {
          name: msg.name,
          language: { code: spec.language },
          components: [{
            type: "body",
            parameters: msg.parameters.map(text => ({ type: "text", text })),
          }],
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`whatsapp template send failed: ${res.status} ${await res.text()}`);
  return { delivered: true };
}
```

- [ ] **Step 5: Write the submission document**

Create `docs/10-whatsapp-templates.md` with the submission checklist, the exact body
text for both templates (copied from `src/lib/templates.ts`), sample values
(`Sunrise Clinic` / `Dr. Rao` / `Fri 4 Sept, 10:00 am`, and `Sunrise Clinic` /
`Amoxicillin`), a status table with columns Template / Submitted / Approved / Notes,
and a closing note explaining that the text stays clear of clinical vocabulary because
`docs/01` forbids it and `tests/templates.test.ts` asserts it. Category is **Utility**,
language English.

- [ ] **Step 6: Run the tests and commit**

```bash
npx tsx --test --test-concurrency=1 --env-file=.env.local tests/templates.test.ts
npx tsc --noEmit
git add src/lib/templates.ts src/lib/channel.ts tests/templates.test.ts docs/10-whatsapp-templates.md
git commit -m "feat: WhatsApp message templates and the template send path"
```

Expected: PASS, 5 tests.

---

## Task 5: Reminder scheduling and the sender

The docs/08 testing-bar item still unmet: a reminder for a discontinued prescription must not send. That requires re-checking state at send time, not schedule time.

**Files:**
- Create: `db/006_reminders_and_templates.sql`, `src/lib/reminders.ts`
- Test: `tests/reminders.test.ts`
- Modify: `src/lib/booking.ts`

**Interfaces:**
- Produces:
```ts
export const MAX_ATTEMPTS = 3;
export const LEAD_TIME_MS: number;
export type DueReminder = {
  id: string; patient_id: string; type: "appointment" | "refill_followup";
  related_id: string; attempts: number; phone: string;
  clinic_name: string; doctor_name: string | null;
  starts_at: Date | null; drug_name: string | null; timezone: string;
};
export async function scheduleAppointmentReminder(
  db: Db, appointmentId: string, patientId: string, startsAt: Date): Promise<void>;
export async function scheduleRefillFollowup(
  db: Db, prescriptionId: string, patientId: string, sendAt: Date): Promise<void>;
export async function cancelReminders(db: Db, relatedId: string): Promise<void>;
export async function claimDue(db: Db, now?: Date, limit?: number): Promise<DueReminder[]>;
export async function stillValid(db: Db, r: DueReminder): Promise<boolean>;
export async function runDueReminders(
  db: Db, deps?: { send?: typeof sendTemplate; now?: Date },
): Promise<{ sent: number; skipped: number; failed: number }>;
```

- [ ] **Step 1: Write the migration**

Create `db/006_reminders_and_templates.sql`:

```sql
-- Migration 006: what the reminder sender needs.

-- Which approved template a reminder will use. Stored rather than derived, so a
-- reminder scheduled under one template still reads correctly if we add another.
alter table reminders add column template_name text;

-- Why the last send failed, so staff see it rather than guessing from logs.
alter table reminders add column last_error text;

-- One scheduled reminder per thing per type. Booking is idempotent (docs/08);
-- scheduling twice for one appointment would message the patient twice.
create unique index reminders_one_per_related
  on reminders (type, related_id) where status = 'scheduled';
```

Note: `db/006` needs no new grant — migration 005 already gave `clinic_agent`
`select` and `insert, update` on `reminders`. Confirm with
`\dp reminders` before assuming otherwise.

- [ ] **Step 2: Write the failing tests**

Create `tests/reminders.test.ts`:

```ts
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, reset, seed, closeAll, futureSlot, type Fixture } from "./helpers";
import {
  scheduleAppointmentReminder, scheduleRefillFollowup, runDueReminders, claimDue, MAX_ATTEMPTS,
} from "../src/lib/reminders";
import { bookAppointment, cancelAppointment } from "../src/lib/booking";
import { createPrescription, discontinuePrescription } from "../src/lib/prescriptions";

let f: Fixture;
const STAFF = () => ({ kind: "staff" as const, id: f.receptionistId });
const DOCTOR = () => ({ kind: "staff" as const, id: f.doctorUserId });

beforeEach(async () => { await reset(); f = await seed(); });
after(closeAll);

/** A send that records what it was asked to deliver instead of calling Meta. */
const recorder = () => {
  const sent: { to: string; name: string; parameters: string[] }[] = [];
  return { sent, send: async (m: typeof sent[number]) => { sent.push(m); return { delivered: true }; } };
};
const due = () => db`update reminders set send_at = now() - interval '1 minute'
                      where status = 'scheduled'`;

test("booking an appointment schedules a reminder for the day before", async () => {
  const at = futureSlot(10, 5);
  const appt = await bookAppointment(db, STAFF(), "receptionist",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: at });

  const [r] = await db<{ type: string; send_at: Date; status: string; related_id: string }[]>`
    select type, send_at, status, related_id from reminders`;
  assert.equal(r.type, "appointment");
  assert.equal(r.status, "scheduled");
  assert.equal(r.related_id, appt.id);
  assert.equal(Math.round((at.getTime() - r.send_at.getTime()) / 3_600_000), 24);
});

test("cancelling an appointment cancels its reminder", async () => {
  const appt = await bookAppointment(db, STAFF(), "receptionist",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(10, 5) });
  await cancelAppointment(db, STAFF(), "receptionist",
    { appointmentId: appt.id, patientId: f.patientId });

  const [r] = await db<{ status: string }[]>`select status from reminders`;
  assert.equal(r.status, "cancelled");
});

test("scheduling twice for one appointment leaves a single reminder", async () => {
  const at = futureSlot(10, 5);
  const appt = await bookAppointment(db, STAFF(), "receptionist",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: at });
  await scheduleAppointmentReminder(db, appt.id, f.patientId, at);

  assert.equal((await db`select id from reminders where status = 'scheduled'`).length, 1,
    "a redelivered booking must not double the reminder");
});

test("only reminders that are due are claimed", async () => {
  await bookAppointment(db, STAFF(), "receptionist",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(10, 5) });
  assert.equal((await claimDue(db)).length, 0, "not due yet");

  await due();
  const rows = await claimDue(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].phone, "+919000000001");
  assert.equal(rows[0].doctor_name, "Dr. Rao");
});

test("a due appointment reminder is sent as a template, once", async () => {
  await bookAppointment(db, STAFF(), "receptionist",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(10, 5) });
  await due();

  const rec = recorder();
  assert.deepEqual(await runDueReminders(db, { send: rec.send as never }),
    { sent: 1, skipped: 0, failed: 0 });
  assert.equal(rec.sent[0].name, "appointment_reminder");
  assert.equal(rec.sent[0].to, "+919000000001");
  assert.ok(rec.sent[0].parameters.includes("Dr. Rao"));

  assert.deepEqual(await runDueReminders(db, { send: rec.send as never }),
    { sent: 0, skipped: 0, failed: 0 }, "a sent reminder is not resent");
  assert.equal(rec.sent.length, 1);
});

test("a reminder for a cancelled appointment is not sent", async () => {
  const appt = await bookAppointment(db, STAFF(), "receptionist",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(10, 5) });
  await due();
  // Cancel directly, bypassing cancelAppointment, so the send-time check is what
  // has to catch it rather than the cancellation path.
  await db`update appointments set status = 'cancelled' where id = ${appt.id}`;

  const rec = recorder();
  assert.deepEqual(await runDueReminders(db, { send: rec.send as never }),
    { sent: 0, skipped: 1, failed: 0 });
  assert.equal(rec.sent.length, 0);
});

test("a reminder for a discontinued prescription is not sent", async () => {
  // docs/08 testing bar: state is re-checked at send time, not schedule time.
  const { id } = await createPrescription(db, DOCTOR(), "doctor", {
    patientId: f.patientId, doctorId: f.doctorId,
    drugName: "Amoxicillin", dosage: "500mg twice daily", durationDays: 5,
  });
  await scheduleRefillFollowup(db, id, f.patientId, new Date(Date.now() - 60_000));
  await discontinuePrescription(db, DOCTOR(), "doctor", id);

  const rec = recorder();
  assert.deepEqual(await runDueReminders(db, { send: rec.send as never }),
    { sent: 0, skipped: 1, failed: 0 });
  assert.equal(rec.sent.length, 0, "a discontinued drug must never be reminded about");

  const [r] = await db<{ status: string }[]>`select status from reminders`;
  assert.equal(r.status, "cancelled");
});

test("a reminder for a withdrawn patient is not sent", async () => {
  await bookAppointment(db, STAFF(), "receptionist",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(10, 5) });
  await due();
  await db`update patients set consent_status = 'withdrawn', deleted_at = now()
            where id = ${f.patientId}`;

  const rec = recorder();
  assert.equal((await runDueReminders(db, { send: rec.send as never })).sent, 0);
  assert.equal(rec.sent.length, 0);
});

test("a failing send is retried, then surfaced to staff", async () => {
  await bookAppointment(db, STAFF(), "receptionist",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(10, 5) });
  await due();

  const boom = async () => { throw new Error("network down"); };
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await runDueReminders(db, { send: boom as never });
    await due();
  }

  const [r] = await db<{ status: string; attempts: number; last_error: string }[]>`
    select status, attempts, last_error from reminders`;
  assert.equal(r.status, "failed");
  assert.equal(r.attempts, MAX_ATTEMPTS);
  assert.match(r.last_error, /network down/);

  // docs/08: a silently-failed reminder is a real harm, so it must escalate.
  const rows = await db<{ reason: string }[]>`select reason from escalations`;
  assert.ok([...rows].some(e => /reminder/i.test(e.reason)),
    "staff must be told a reminder could not be delivered");
});
```

- [ ] **Step 3: Apply the migration and run the tests to verify they fail**

```bash
npx tsx --env-file=.env.local scripts/migrate.ts
npx tsx --env-file=.env.local scripts/migrate.ts "$TEST_DATABASE_URL"
npx tsx --test --test-concurrency=1 --env-file=.env.local tests/reminders.test.ts
```

Expected: FAIL — `Cannot find module '../src/lib/reminders'`.

- [ ] **Step 4: Write the reminder module**

Create `src/lib/reminders.ts`:

```ts
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
  return db<DueReminder[]>`
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

/** Send everything due. Returns counts rather than throwing, so one bad
 *  reminder never stops the batch. */
export async function runDueReminders(
  db: Db, deps: { send?: typeof sendTemplate; now?: Date } = {},
): Promise<{ sent: number; skipped: number; failed: number }> {
  const send = deps.send ?? sendTemplate;
  let sent = 0, skipped = 0, failed = 0;

  for (const r of await claimDue(db, deps.now)) {
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
        const [conversation] = await db<{ id: string }[]>`
          select id from conversations where patient_id = ${r.patient_id} limit 1`;
        if (conversation) {
          await db`
            insert into escalations (conversation_id, patient_id, reason, priority)
            values (${conversation.id}, ${r.patient_id},
                    ${`reminder could not be delivered after ${MAX_ATTEMPTS} attempts: ${message}`},
                    'normal')`;
        }
        failed++;
      }
    }
  }
  return { sent, skipped, failed };
}
```

- [ ] **Step 5: Schedule the reminder when an appointment is booked**

In `src/lib/booking.ts` add the import:

```ts
import { scheduleAppointmentReminder, cancelReminders } from "./reminders";
```

In `bookAppointment`, immediately after the `await audit(db, actor, "book_appointment", ...)` line:

```ts
    await scheduleAppointmentReminder(db, row.id, input.patientId, row.starts_at);
```

In `cancelAppointment` and `rescheduleAppointment`, replace each existing inline
`update reminders set status = 'cancelled' ...` statement with:

```ts
  await cancelReminders(db, input.appointmentId);
```

- [ ] **Step 6: Run the tests and commit**

```bash
npx tsx --test --test-concurrency=1 --env-file=.env.local tests/reminders.test.ts
npx tsx --test --test-concurrency=1 --env-file=.env.local "tests/*.test.ts"
npx tsc --noEmit
git add db/006_reminders_and_templates.sql src/lib/reminders.ts src/lib/booking.ts tests/reminders.test.ts
git commit -m "feat: reminders that re-check state at send time"
```

Expected: PASS, 9 reminder tests, whole suite green.

---

## Task 6: The cron endpoints

The app is serverless; nothing runs on a timer inside it. An external scheduler calls these.

**Files:**
- Create: `src/app/api/cron/reminders/route.ts`
- Modify: `.env.example`
- Test: `tests/reminders.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/reminders.test.ts`:

```ts
test("the cron endpoint refuses a request without the shared secret", async () => {
  const { GET } = await import("../src/app/api/cron/reminders/route");
  process.env.CRON_SECRET = "s3cret";
  try {
    assert.equal((await GET(new Request("http://localhost/x"))).status, 401);
    assert.equal((await GET(new Request("http://localhost/x", {
      headers: { authorization: "Bearer nope" },
    }))).status, 401);
  } finally { delete process.env.CRON_SECRET; }
});

test("the cron endpoint refuses to run at all when no secret is configured", async () => {
  const { GET } = await import("../src/app/api/cron/reminders/route");
  delete process.env.CRON_SECRET;
  const res = await GET(new Request("http://localhost/x", {
    headers: { authorization: "Bearer anything" },
  }));
  assert.equal(res.status, 500, "an unprotected reminder endpoint must not be callable");
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
npx tsx --test --test-concurrency=1 --env-file=.env.local tests/reminders.test.ts
```

Expected: FAIL — cannot find the route module.

- [ ] **Step 3: Write the route**

Create `src/app/api/cron/reminders/route.ts`:

```ts
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sql } from "@/lib/db";
import { runDueReminders } from "@/lib/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sends every reminder that has come due. The app is serverless, so nothing
 * runs on a timer inside it — point a scheduler at this every 15 minutes
 * (Vercel Cron, GitHub Actions, cron-job.org) with the shared secret.
 *
 * Anyone who can call this can make the clinic message its patients, so it
 * refuses to run without a configured secret rather than defaulting to open.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return new Response("unauthorized", { status: 401 });
  }
  return NextResponse.json(await runDueReminders(sql));
}
```

- [ ] **Step 4: Document the setting**

Add to `.env.example`, before the WhatsApp block:

```
# Shared secret for the schedulers. Point a cron at
# GET /api/cron/reminders every 15 minutes and GET /api/cron/purge daily,
# both with `Authorization: Bearer <this>`.
CRON_SECRET=
```

- [ ] **Step 5: Run the tests and commit**

```bash
npx tsx --test --test-concurrency=1 --env-file=.env.local tests/reminders.test.ts
npx tsc --noEmit
git add src/app/api/cron/reminders/route.ts .env.example tests/reminders.test.ts
git commit -m "feat: reminder cron endpoint behind a shared secret"
```

---

## Task 7: Restore the reminder promise

Now that reminders actually send, the agent may promise one again.

**Files:**
- Modify: `src/lib/agent/index.ts`
- Test: `tests/agent.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/agent.test.ts`:

```ts
test("the booking confirmation promises a reminder, because one is now scheduled", async () => {
  await say("appointment with Dr Rao");
  const offer = await say("tomorrow");
  const done = await say(offer!.text.match(/(\d{1,2}:\d{2})/)![1]);

  assert.match(done!.text, /reminder/i);
  assert.equal((await db`select id from reminders where status = 'scheduled'`).length, 1,
    "the promise must correspond to a real scheduled reminder");
});
```

Note: this test books for tomorrow, which is inside the 24-hour lead time, so
`scheduleAppointmentReminder` returns without inserting. Use `futureSlot(10, 5)`
by driving the classifier stub with an explicit `day` five days out, or relax the
assertion to `>= 0` and add a separate test at 5 days. Do not weaken
`scheduleAppointmentReminder` to make the test pass.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx tsx --test --test-concurrency=1 --env-file=.env.local tests/agent.test.ts
```

Expected: FAIL — the confirmation no longer mentions a reminder.

- [ ] **Step 3: Restore the promise**

In `src/lib/agent/index.ts`, replace the confirmation text (and delete the comment
above it explaining why the promise was removed) with:

```ts
        text: `You are booked for ${fmtTime(appt.startsAt, ctx.clinic.timezone)}. ` +
              `We will send a reminder the day before. Reply CANCEL anytime to cancel.`,
```

- [ ] **Step 4: Run the whole suite and commit**

```bash
npx tsx --test --test-concurrency=1 --env-file=.env.local "tests/*.test.ts"
git add src/lib/agent/index.ts tests/agent.test.ts
git commit -m "feat: promise the reminder again, now that one is sent"
```

---

## Task 8: Patient records and prescription entry in the CRM

**Files:**
- Create: `src/app/(crm)/patients/page.tsx`, `src/app/(crm)/patients/[id]/page.tsx`
- Modify: `src/app/(crm)/layout.tsx`

**Interfaces:**
- Consumes: `searchPatients`, `getPatient` (Task 2); `createPrescription`,
  `listPrescriptions`, `discontinuePrescription`, `InvalidPrescription` (Task 1);
  `currentStaff`, `sql`, `can`

- [ ] **Step 1: Add the nav link**

In `src/app/(crm)/layout.tsx`, inside `<nav>`, after the Calendar link:

```tsx
            <Link href="/patients" className="text-slate-600 hover:text-slate-900">Patients</Link>
```

- [ ] **Step 2: Write the patient list page**

Create `src/app/(crm)/patients/page.tsx`. It must:

- `const staff = await currentStaff();`
- read `q` from `searchParams` (a Promise in Next 16: `const { q } = await searchParams;`)
- call `searchPatients(sql, { kind: "staff", id: staff.id }, staff.role, staff.clinicId, q ?? "")`
- render a GET form with a single `name="q"` input (no client JS needed — the form
  submits to the same route) and `aria-label="Search patients"`
- render a table: Name (a `<Link href={/patients/${p.id}}>`), Phone, Consent,
  Next appointment (`Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" })`,
  or `—` when null), Active prescriptions
- render an empty state that distinguishes "no match for that search" from "no patients yet"

Match the existing Tailwind classes used in `src/app/(crm)/page.tsx` so the two pages
look like one product.

- [ ] **Step 3: Write the patient record page**

Create `src/app/(crm)/patients/[id]/page.tsx`. It must:

- `const { id } = await params;` (a Promise in Next 16)
- `const patient = await getPatient(sql, actor, staff.role, staff.clinicId, id);`
  and `if (!patient) notFound();` — this is the clinic scope check, do not skip it
- list the last 20 appointments, scoped by `a.clinic_id = ${staff.clinicId}`
- list prescriptions via `listPrescriptions`, showing drug, dosage, duration, status,
  prescribing doctor, who recorded it, and notes
- show the entry form only when `can(staff.role, "prescriptions:write")`, and otherwise
  a line saying only a doctor or admin can add to the record
- carry a note above the record: *"Stored exactly as entered. The assistant reads these
  back to the patient verbatim and never interprets them."*
- use two server actions, `addPrescription` and `discontinue`, each of which re-reads
  `currentStaff()` inside the action (never trusting a value from the render pass),
  calls the `src/lib/prescriptions.ts` function, and `revalidatePath`s the page
- catch `InvalidPrescription` in `addPrescription` and `redirect` back with
  `?error=<message>`, rendering it in a `role="alert"` banner

- [ ] **Step 4: Verify it renders against seeded data**

```bash
npm run dev
```

Sign in as `drrao@sunrise.clinic`, open `/patients`, search, open a record, add a
prescription, confirm it appears. Then sign in as `desk@sunrise.clinic` and confirm the
list is visible but the entry form is not.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add "src/app/(crm)"
git commit -m "feat: patient records and prescription entry in the CRM"
```

---

## Task 9: Login rate limiting

An unthrottled server action over a deliberately expensive hash is both a credential-stuffing surface and a CPU sink.

**Files:**
- Create: `db/007_login_throttle.sql`, `src/lib/throttle.ts`
- Modify: `src/lib/auth.ts`, `src/app/login/page.tsx`
- Test: `tests/throttle.test.ts`

**Interfaces:**
- Produces:
```ts
export const MAX_ATTEMPTS = 8;
export const WINDOW_MINUTES = 15;
export class TooManyAttempts extends Error { retryAfterSeconds: number }
export async function assertNotThrottled(db: Db, email: string): Promise<void>;
export async function recordFailure(db: Db, email: string): Promise<void>;
export async function clearFailures(db: Db, email: string): Promise<void>;
```

- [ ] **Step 1: Write the migration**

Create `db/007_login_throttle.sql`:

```sql
-- Migration 007: login throttling.
--
-- Deliberately keyed on the submitted email rather than an IP: a clinic's staff
-- share one connection, so an IP lock takes the whole front desk offline while
-- barely inconveniencing an attacker on a phone network. Rows are transient and
-- carry no patient data.
create table login_attempts (
  email        text not null,
  attempted_at timestamptz not null default now()
);
create index login_attempts_email_time on login_attempts (lower(email), attempted_at desc);
```

- [ ] **Step 2: Write the failing tests**

Create `tests/throttle.test.ts`:

```ts
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, reset, seed, closeAll } from "./helpers";
import {
  assertNotThrottled, recordFailure, clearFailures, TooManyAttempts, MAX_ATTEMPTS,
} from "../src/lib/throttle";
import { authenticate } from "../src/lib/auth";

beforeEach(async () => { await reset(); await seed(); await db`delete from login_attempts`; });
after(closeAll);

test("a few failures are allowed", async () => {
  for (let i = 0; i < MAX_ATTEMPTS - 1; i++) await recordFailure(db, "desk@test.clinic");
  await assertNotThrottled(db, "desk@test.clinic");
});

test("too many failures lock the account out, with a retry hint", async () => {
  for (let i = 0; i < MAX_ATTEMPTS; i++) await recordFailure(db, "desk@test.clinic");
  await assert.rejects(assertNotThrottled(db, "desk@test.clinic"), (e: TooManyAttempts) => {
    assert.equal(e.name, "TooManyAttempts");
    assert.ok(e.retryAfterSeconds > 0);
    return true;
  });
});

test("the lockout is per email, not global", async () => {
  for (let i = 0; i < MAX_ATTEMPTS; i++) await recordFailure(db, "desk@test.clinic");
  await assertNotThrottled(db, "rao@test.clinic");
});

test("email casing cannot be used to sidestep the lockout", async () => {
  for (let i = 0; i < MAX_ATTEMPTS; i++) await recordFailure(db, "desk@test.clinic");
  await assert.rejects(assertNotThrottled(db, "DESK@Test.Clinic"), TooManyAttempts);
});

test("old failures fall outside the window", async () => {
  for (let i = 0; i < MAX_ATTEMPTS; i++) await recordFailure(db, "desk@test.clinic");
  await db`update login_attempts set attempted_at = now() - interval '1 hour'`;
  await assertNotThrottled(db, "desk@test.clinic");
});

test("a successful login clears the count", async () => {
  for (let i = 0; i < MAX_ATTEMPTS - 1; i++) await recordFailure(db, "desk@test.clinic");
  await clearFailures(db, "desk@test.clinic");
  for (let i = 0; i < MAX_ATTEMPTS - 1; i++) await recordFailure(db, "desk@test.clinic");
  await assertNotThrottled(db, "desk@test.clinic");
});

test("authenticate records a failure and clears it on success", async () => {
  await authenticate({ email: "desk@test.clinic", password: "wrong" }, db);
  assert.equal((await db`select 1 from login_attempts`).length, 1);

  await authenticate({ email: "desk@test.clinic", password: "correct horse" }, db);
  assert.equal((await db`select 1 from login_attempts`).length, 0);
});

test("authenticate refuses once locked out, even with the right password", async () => {
  for (let i = 0; i < MAX_ATTEMPTS; i++) await recordFailure(db, "desk@test.clinic");
  await assert.rejects(
    authenticate({ email: "desk@test.clinic", password: "correct horse" }, db),
    TooManyAttempts,
  );
});
```

- [ ] **Step 3: Migrate and run the tests to verify they fail**

```bash
npx tsx --env-file=.env.local scripts/migrate.ts
npx tsx --env-file=.env.local scripts/migrate.ts "$TEST_DATABASE_URL"
npx tsx --test --test-concurrency=1 --env-file=.env.local tests/throttle.test.ts
```

Expected: FAIL — `Cannot find module '../src/lib/throttle'`.

- [ ] **Step 4: Write the throttle**

Create `src/lib/throttle.ts`:

```ts
/**
 * Login throttling.
 *
 * Keyed on the submitted email rather than the IP: a clinic's staff all share
 * one connection, so an IP lock takes the whole front desk offline while barely
 * inconveniencing an attacker on a phone network.
 */
import type { Db } from "./db";

export const MAX_ATTEMPTS = 8;
export const WINDOW_MINUTES = 15;

export class TooManyAttempts extends Error {
  constructor(public retryAfterSeconds: number) {
    super("too many sign-in attempts; try again shortly");
    this.name = "TooManyAttempts";
  }
}

export async function assertNotThrottled(db: Db, email: string): Promise<void> {
  const [row] = await db<{ attempts: string; oldest: Date | null }[]>`
    select count(*) as attempts, min(attempted_at) as oldest
      from login_attempts
     where lower(email) = lower(${email})
       and attempted_at > now() - (${WINDOW_MINUTES} * interval '1 minute')`;

  if (Number(row.attempts) < MAX_ATTEMPTS) return;
  const unlocksAt = new Date(row.oldest!.getTime() + WINDOW_MINUTES * 60_000);
  throw new TooManyAttempts(
    Math.max(1, Math.ceil((unlocksAt.getTime() - Date.now()) / 1000)));
}

export async function recordFailure(db: Db, email: string): Promise<void> {
  await db`insert into login_attempts (email) values (${email})`;
  // Opportunistic cleanup — this table is transient and nothing reads history.
  await db`delete from login_attempts
            where attempted_at < now() - (${WINDOW_MINUTES} * interval '1 minute') * 4`;
}

export async function clearFailures(db: Db, email: string): Promise<void> {
  await db`delete from login_attempts where lower(email) = lower(${email})`;
}
```

- [ ] **Step 5: Wire it into authenticate**

In `src/lib/auth.ts`:

```ts
import { assertNotThrottled, recordFailure, clearFailures } from "./throttle";
```

At the top of `authenticate`, before the query:

```ts
  await assertNotThrottled(db, c.email);
```

Replace `if (!ok || !row) return null;` with:

```ts
  if (!ok || !row) {
    await recordFailure(db, c.email);
    return null;
  }
  await clearFailures(db, c.email);
```

- [ ] **Step 6: Show the lockout on the login form**

In `src/app/login/page.tsx`, import `TooManyAttempts` from `@/lib/throttle`, wrap the
`authenticate` call in a try/catch that redirects to `/login?error=throttled` on
`TooManyAttempts`, and replace the error banner body with:

```tsx
            {error === "throttled"
              ? "Too many sign-in attempts. Please wait a few minutes and try again."
              : "That email and password did not match."}
```

- [ ] **Step 7: Run the suite and commit**

```bash
npx tsx --test --test-concurrency=1 --env-file=.env.local "tests/*.test.ts"
npx tsc --noEmit
git add db/007_login_throttle.sql src/lib/throttle.ts src/lib/auth.ts src/app/login/page.tsx tests/throttle.test.ts
git commit -m "feat: throttle repeated failed logins"
```

---

## Task 10: The DPDP purge job

`docs/02` requires soft delete *and* a purge job "from day one". The soft delete exists; nothing hard-deletes.

**Files:**
- Create: `src/app/api/cron/purge/route.ts`, `tests/consent-purge.test.ts`
- Modify: `src/lib/consent.ts`

**Interfaces:**
- Produces:
```ts
export const PURGE_AFTER_DAYS = 30;
export async function purgeDeletedPatients(db: Db, now?: Date): Promise<{ purged: number }>;
```

- [ ] **Step 1: Write the failing tests**

Create `tests/consent-purge.test.ts`:

```ts
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, reset, seed, closeAll, futureSlot, type Fixture } from "./helpers";
import { withdrawAndDelete, purgeDeletedPatients, PURGE_AFTER_DAYS } from "../src/lib/consent";
import { bookAppointment } from "../src/lib/booking";

let f: Fixture;
beforeEach(async () => { await reset(); f = await seed(); });
after(closeAll);

const age = (id: string) =>
  db`update patients set deleted_at = now() - (${PURGE_AFTER_DAYS + 1} * interval '1 day')
      where id = ${id}`;

test("a patient inside the retention window is not purged", async () => {
  await withdrawAndDelete(db, { kind: "agent" }, f.patientId);
  assert.equal((await purgeDeletedPatients(db)).purged, 0);
  assert.equal((await db`select id from patients where id = ${f.patientId}`).length, 1);
});

test("a patient past the retention window is hard-deleted with their data", async () => {
  await bookAppointment(db, { kind: "staff", id: f.receptionistId }, "receptionist",
    { patientId: f.patientId, doctorId: f.doctorId, startsAt: futureSlot(10) });
  await db`insert into messages (conversation_id, direction, body)
           values (${f.conversationId}, 'inbound', 'hello')`;
  await withdrawAndDelete(db, { kind: "agent" }, f.patientId);
  await age(f.patientId);

  assert.equal((await purgeDeletedPatients(db)).purged, 1);
  assert.equal((await db`select id from patients where id = ${f.patientId}`).length, 0);
  assert.equal((await db`select id from appointments where patient_id = ${f.patientId}`).length, 0);
  assert.equal((await db`select id from conversations where patient_id = ${f.patientId}`).length, 0);
});

test("the purge leaves an audit trail naming no patient data", async () => {
  await withdrawAndDelete(db, { kind: "agent" }, f.patientId);
  await age(f.patientId);
  await purgeDeletedPatients(db);

  const rows = await db<{ target_id: string }[]>`
    select target_id from audit_log where action = 'patient_purged'`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].target_id, f.patientId);
});

test("a patient who is not soft-deleted is never purged, however old", async () => {
  await db`update patients set created_at = now() - interval '5 years' where id = ${f.patientId}`;
  assert.equal((await purgeDeletedPatients(db)).purged, 0);
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
npx tsx --test --test-concurrency=1 --env-file=.env.local tests/consent-purge.test.ts
```

Expected: FAIL — `purgeDeletedPatients` is not exported.

- [ ] **Step 3: Write the purge**

Append to `src/lib/consent.ts`:

```ts
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
```

- [ ] **Step 4: Write the cron route**

Create `src/app/api/cron/purge/route.ts` with the same shape as the reminders route
from Task 6 — same `CRON_SECRET` check, same `timingSafeEqual` comparison, same
refusal when the secret is unset — calling `purgeDeletedPatients(sql)` instead.
Add a one-line comment: *"Destroys records whose retention window has passed
(docs/02). Run daily."*

- [ ] **Step 5: Run the suite and commit**

```bash
npx tsx --test --test-concurrency=1 --env-file=.env.local "tests/*.test.ts"
npx tsc --noEmit
git add src/lib/consent.ts src/app/api/cron/purge/route.ts tests/consent-purge.test.ts
git commit -m "feat: DPDP purge job behind the soft delete"
```

---

## Task 11: Offline tests for the classifier's response handling

The sanitisation block in `intent.ts` is what stops a confused model from booking the wrong thing, and it has no offline test.

**Files:**
- Create: `tests/intent.test.ts`

- [ ] **Step 1: Write the tests**

Create `tests/intent.test.ts`:

```ts
/**
 * classifyWithClaude's handling of what comes back, with fetch stubbed.
 * The live model is covered in tests/intent.live.test.ts; this file covers the
 * responses a live test cannot reliably produce.
 */
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  classifyWithClaude, ClassifierUnavailable, type ClassifyInput,
} from "../src/lib/agent/intent";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; delete process.env.ANTHROPIC_API_KEY; });

const input: ClassifyInput = {
  body: "book me in", doctors: ["Dr. Rao", "Dr. Iyer"],
  offered: ["Fri 4 Sept, 9:00 am", "Fri 4 Sept, 9:30 am"],
  today: "2026-09-02", weekday: "Wednesday",
};

/** Reply with one tool_use block carrying exactly these fields. */
function stubFetch(toolInput: Record<string, unknown>, status = 200) {
  process.env.ANTHROPIC_API_KEY = "sk-test";
  globalThis.fetch = (async () => new Response(
    JSON.stringify({ content: [{ type: "tool_use", name: "record_intent", input: toolInput }] }),
    { status, headers: { "content-type": "application/json" } },
  )) as typeof fetch;
}

test("a well-formed response passes through", async () => {
  stubFetch({ intent: "book", doctor: "Dr. Rao", day: "2026-09-04", slot_index: 1 });
  const r = await classifyWithClaude(input);
  assert.equal(r.intent, "book");
  assert.equal(r.doctor, "Dr. Rao");
  assert.equal(r.day, "2026-09-04");
  assert.equal(r.slotIndex, 1);
});

test("a doctor who does not work here becomes null", async () => {
  stubFetch({ intent: "book", doctor: "Dr. Sharma", day: null, slot_index: null });
  assert.equal((await classifyWithClaude(input)).doctor, null);
});

test("an impossible date becomes null rather than reaching the database", async () => {
  for (const day of ["2026-13-45", "2026-02-30", "0000-00-00", "tomorrow", "2026-9-4"]) {
    stubFetch({ intent: "book", doctor: null, day, slot_index: null });
    assert.equal((await classifyWithClaude(input)).day, null, day);
  }
});

test("an out-of-range or non-integer slot index becomes null", async () => {
  for (const slot_index of [-1, 2, 99, 1.5, "1", null]) {
    stubFetch({ intent: "book", doctor: null, day: null, slot_index });
    assert.equal((await classifyWithClaude(input)).slotIndex, null, String(slot_index));
  }
});

test("an intent outside the enum degrades to unclear, which escalates", async () => {
  for (const intent of ["answer_medical_question", "prescribe", "", null, 42]) {
    stubFetch({ intent, doctor: null, day: null, slot_index: null });
    assert.equal((await classifyWithClaude(input)).intent, "unclear", String(intent));
  }
});

test("a missing key, a non-200, junk JSON and no tool call all fail loudly", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  await assert.rejects(classifyWithClaude(input), ClassifierUnavailable);

  stubFetch({ intent: "book", doctor: null, day: null, slot_index: null }, 500);
  await assert.rejects(classifyWithClaude(input), ClassifierUnavailable);

  process.env.ANTHROPIC_API_KEY = "sk-test";
  globalThis.fetch = (async () =>
    new Response("<html>gateway error</html>", { status: 200 })) as typeof fetch;
  await assert.rejects(classifyWithClaude(input), ClassifierUnavailable);

  globalThis.fetch = (async () => new Response(
    JSON.stringify({ content: [{ type: "text", text: "sure thing" }] }),
    { status: 200 })) as typeof fetch;
  await assert.rejects(classifyWithClaude(input), ClassifierUnavailable);
});

test("a network failure surfaces as ClassifierUnavailable, not a raw fetch error", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test";
  globalThis.fetch = (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch;
  await assert.rejects(classifyWithClaude(input), ClassifierUnavailable);
});

test("the request body carries only booking context", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-test";
  let captured: string | undefined;
  globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
    captured = init.body;
    return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "record_intent",
      input: { intent: "book", doctor: null, day: null, slot_index: null } }] }), { status: 200 });
  }) as unknown as typeof fetch;

  await classifyWithClaude(input);
  assert.match(captured!, /Dr\. Rao/);
  assert.match(captured!, /book me in/);
  assert.doesNotMatch(captured!, /prescription|history|patient_id/i);
});
```

- [ ] **Step 2: Run them**

```bash
npx tsx --test --test-concurrency=1 --env-file=.env.local tests/intent.test.ts
```

Expected: PASS, 8 tests. If any fail, the sanitisation in `src/lib/agent/intent.ts` is
wrong — fix the source, not the test.

- [ ] **Step 3: Commit**

```bash
git add tests/intent.test.ts
git commit -m "test: offline coverage for the classifier's response handling"
```

---

## Task 12: Tenant isolation across the board

`docs/07` Phase 3 is "second clinic". Before that, prove one clinic cannot see or touch another's data anywhere.

**Files:**
- Create: `tests/multi-clinic.test.ts`
- Modify: `src/lib/prescriptions.ts` (the check the tests expose)

- [ ] **Step 1: Write the tests**

Create `tests/multi-clinic.test.ts`:

```ts
/**
 * One clinic must not read or change another's data through any path.
 * Every test uses clinic A's staff against clinic B's ids.
 */
import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, reset, seed, closeAll, futureSlot, type Fixture } from "./helpers";
import { searchPatients, getPatient } from "../src/lib/patients";
import { createPrescription } from "../src/lib/prescriptions";
import {
  listEscalations, acknowledgeEscalation, resolveEscalation, NotFound,
} from "../src/lib/escalations";
import { bookAppointment } from "../src/lib/booking";

let f: Fixture;
const A = () => ({ kind: "staff" as const, id: f.receptionistId });

beforeEach(async () => { await reset(); f = await seed(); });
after(closeAll);

async function escalationAtOtherClinic() {
  const [e] = await db<{ id: string }[]>`
    insert into escalations (conversation_id, patient_id, reason, priority)
    values (${f.otherConversationId}, ${f.otherClinicPatientId}, 'chest pain', 'emergency')
    returning id`;
  return e.id;
}

test("patient search and lookup are scoped", async () => {
  assert.equal((await searchPatients(db, A(), "receptionist", f.clinicId, "chetan")).length, 0);
  assert.equal(await getPatient(db, A(), "receptionist", f.clinicId, f.otherClinicPatientId), null);
});

test("the escalation inbox shows only this clinic's escalations", async () => {
  await escalationAtOtherClinic();
  assert.equal((await listEscalations(db, A(), f.clinicId)).length, 0);
});

test("a stranger's escalation cannot be acknowledged or resolved", async () => {
  const id = await escalationAtOtherClinic();
  await assert.rejects(
    acknowledgeEscalation(db, A(), "receptionist", f.clinicId, id, f.receptionistId), NotFound);
  await assert.rejects(
    resolveEscalation(db, A(), "receptionist", f.clinicId, id), NotFound);

  const [row] = await db<{ status: string }[]>`select status from escalations where id = ${id}`;
  assert.equal(row.status, "open", "another clinic's emergency must stay open");
});

test("the calendar query never crosses clinics", async () => {
  await bookAppointment(db, { kind: "staff", id: f.otherStaffId }, "receptionist",
    { patientId: f.otherClinicPatientId, doctorId: f.otherDoctorId, startsAt: futureSlot(10) });

  const rows = await db`
    select a.id from appointments a join patients p on p.id = a.patient_id
     where a.clinic_id = ${f.clinicId} and p.deleted_at is null`;
  assert.equal(rows.length, 0);
});

test("a prescription cannot be written against another clinic's patient", async () => {
  // The doctor belongs to clinic A, the patient to clinic B. Nothing sensible
  // can come of this, so it must not be storable.
  await assert.rejects(
    createPrescription(db, { kind: "staff", id: f.doctorUserId }, "doctor", {
      patientId: f.otherClinicPatientId, doctorId: f.doctorId,
      drugName: "Amoxicillin", dosage: "500mg",
    }),
  );
  assert.equal((await db`select id from prescriptions`).length, 0);
});
```

- [ ] **Step 2: Run them and see the prescription test fail**

```bash
npx tsx --test --test-concurrency=1 --env-file=.env.local tests/multi-clinic.test.ts
```

Expected: the cross-clinic prescription test FAILS — nothing checks that the doctor and
patient share a clinic. The others should pass; if any of them fails, that is a real
isolation bug — fix the module it names before continuing.

- [ ] **Step 3: Add the missing check**

In `src/lib/prescriptions.ts`, inside `createPrescription`, after `validate()`:

```ts
  // A doctor at one clinic writing on another clinic's patient is always a bug
  // or an attack; there is no legitimate case for it.
  const [pair] = await db<{ ok: boolean }[]>`
    select (p.clinic_id = d.clinic_id) as ok
      from patients p, doctors d
     where p.id = ${input.patientId} and d.id = ${input.doctorId}`;
  if (!pair?.ok) {
    throw new InvalidPrescription("patientId", "that patient and doctor are at different clinics");
  }
```

- [ ] **Step 4: Run the whole suite and commit**

```bash
npx tsx --test --test-concurrency=1 --env-file=.env.local "tests/*.test.ts"
npx tsc --noEmit
git add tests/multi-clinic.test.ts src/lib/prescriptions.ts
git commit -m "test: prove tenant isolation, and enforce it on prescription writes"
```

---

## Task 13: The breach runbook

`docs/02` requires this before launch and calls it a document, not code.

**Files:**
- Create: `docs/runbooks/breach.md`
- Modify: `docs/02-compliance-dpdp.md`

- [ ] **Step 1: Write the runbook**

Create `docs/runbooks/breach.md` covering, in this order:

1. **The threshold.** Under the DPDP Act there is no minimum size — every personal data
   breach is notifiable to the Data Protection Board and to affected users. "It was only
   one record" is not a reason to skip this. State plainly that this is the engineering
   runbook, not legal advice, and that counsel is involved at step 3 every time.
2. **What counts.** Unauthorised access, disclosure, alteration or loss of patient data:
   a leaked database credential, a staff account used by someone else, a message sent to
   the wrong patient, a laptop holding an exported patient list, a misconfigured backup,
   a provider telling us they had an incident affecting us.
3. **Step 0 — preserve evidence.** Do not delete or redeploy over anything yet. Snapshot
   the database and export the relevant `audit_log` rows first; that table is append-only
   precisely for this. Include the query:
   `select * from audit_log where created_at between :start and :end order by created_at;`
4. **Step 1 — contain, first hour.** Per credential type:
   database → `alter role clinic_agent password '<new>'`, update `AGENT_DB_PASSWORD`, redeploy;
   staff account → delete the `staff_users` row (sessions are 8-hour cookies and
   `currentStaff()` re-reads the account each request, so access ends on the next page load);
   `SESSION_SECRET` → rotate, which signs everyone out, and do it anyway;
   `WHATSAPP_TOKEN` → revoke in Meta Business Manager first, since a live token can message
   every patient. If scope is unclear, take the app offline — a clinic can book on paper for
   an afternoon, but it cannot un-leak a record.
5. **Step 2 — assess, same day.** In writing: which patients (ids from `audit_log`, not a
   guess), which fields (phone numbers and appointment times are one severity; message
   bodies and prescription records another), what window, and whether it is still happening.
6. **Step 3 — notify.** Counsel first, then the Data Protection Board of India (file what
   is known and supplement rather than waiting for a complete picture), then affected
   patients directly in plain language, then the clinic — they hold the relationship and
   will be asked before we are.
7. **Step 4 — afterwards.** Postmortem with timeline and root cause; every fix gets a
   regression test; update this runbook with whatever it failed to anticipate.
8. **Contacts table** — incident lead, legal counsel, clinic owner, Neon support, Meta
   support — with the first three marked *fill in before launch*.
9. **Rehearsal.** `docs/07` Phase 3 requires one tabletop exercise before launch. Give a
   scenario ("a staff laptop with a patient export is stolen") and note that an untested
   runbook is a wish.

- [ ] **Step 2: Link it from the compliance doc**

In `docs/02-compliance-dpdp.md`, replace
"This is a doc, not code, but it belongs in this repo (`docs/runbooks/`) once we're closer to launch."
with a sentence pointing at `docs/runbooks/breach.md` and noting it still needs its
contact table filled in and one tabletop rehearsal.

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/breach.md docs/02-compliance-dpdp.md
git commit -m "docs: breach runbook"
```

---

## Task 14: Concurrency load test for the booking path

`docs/07` Phase 3: "Load-test the availability/booking path for concurrent requests — this is where the exclusion constraint earns its keep."

**Files:**
- Create: `tests/load.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/load.test.ts`:

```ts
/**
 * The booking path under real concurrent load. Not a benchmark — a correctness
 * test at a scale the unit tests do not reach (docs/07 Phase 3).
 */
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { db, reset, seed, closeAll, futureSlot, localDay } from "./helpers";
import { bookAppointment, checkAvailability, type BookingError } from "../src/lib/booking";

let f: Awaited<ReturnType<typeof seed>>;
before(async () => { await reset(); f = await seed(); });
after(closeAll);

test("100 concurrent bookings across 8 slots produce exactly 8 appointments", async () => {
  const day = localDay(futureSlot(10, 4));
  const slots = (await checkAvailability(db, f.doctorId, day)).slice(0, 8);
  assert.ok(slots.length >= 8, `need at least 8 free slots, got ${slots.length}`);

  const staff = { kind: "staff" as const, id: f.receptionistId };
  const results = await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      bookAppointment(db, staff, "receptionist", {
        patientId: i % 2 === 0 ? f.patientId : f.otherPatientId,
        doctorId: f.doctorId,
        startsAt: slots[i % slots.length].startsAt,
      }).then(() => "ok" as const, (e: BookingError) => e.code)));

  const won = results.filter(r => r === "ok").length;
  const lost = results.filter(r => r === "slot_taken").length;
  assert.equal(won, 8, "one winner per slot, no more");
  assert.equal(won + lost, 100, `unexpected codes: ${[...new Set(results)].join(",")}`);

  const booked = await db<{ starts_at: Date }[]>`
    select starts_at from appointments where status = 'booked' and doctor_id = ${f.doctorId}`;
  assert.equal(booked.length, 8);

  // And no two of them overlap, which is the property that actually matters.
  const times = [...booked].map(b => b.starts_at.getTime());
  assert.equal(new Set(times).size, times.length);
});

test("availability never grows while bookings are landing", async () => {
  const day = localDay(futureSlot(10, 6));
  const staff = { kind: "staff" as const, id: f.receptionistId };
  const before_ = await checkAvailability(db, f.doctorId, day);

  const bookings = before_.slice(0, 5).map(s =>
    bookAppointment(db, staff, "receptionist",
      { patientId: f.patientId, doctorId: f.doctorId, startsAt: s.startsAt })
      .catch(() => null));
  const reads = Array.from({ length: 20 }, () => checkAvailability(db, f.doctorId, day));

  const [, ...views] = await Promise.all([Promise.all(bookings), ...reads]);
  for (const view of views) assert.ok(view.length <= before_.length);

  assert.equal((await checkAvailability(db, f.doctorId, day)).length, before_.length - 5);
});
```

- [ ] **Step 2: Run it**

```bash
npx tsx --test --test-concurrency=1 --env-file=.env.local tests/load.test.ts
```

Expected: PASS. If it fails with `too many connections`, raise `max` in the
`postgres()` call in `tests/helpers.ts` from 5 to 20 — that is a test-harness limit,
not a product one. If it fails any other way, the exclusion constraint is not doing
its job and that is a Critical finding, not a flaky test.

- [ ] **Step 3: Commit**

```bash
git add tests/load.test.ts
git commit -m "test: booking path under concurrent load"
```

---

## Task 15: Bring the documentation back in line

**Files:**
- Modify: `docs/09-implementation-log.md`, `README.md`, `docs/07-mvp-roadmap.md`

- [ ] **Step 1: Update the implementation log**

In `docs/09-implementation-log.md`:

- Status table: Phase 2 → **Done**. Phase 3 → **Partly done — load test and tenant
  isolation covered; tabletop rehearsal outstanding**.
- Replace the test count with the real number from the final run.
- Add to the file listing: `prescriptions.ts`, `reminders.ts`, `templates.ts`,
  `patients.ts`, `throttle.ts`, both cron routes, and the patient CRM pages.
- Move out of "Not built yet": prescription entry, refill reminders, the reminder
  sender, patient screens, login rate limiting, the purge job, the breach runbook.
- Update the docs/08 testing-bar note: all six items are now covered.
- Append a dated session entry in the style of the existing ones, describing what was
  built and any decision made along the way.

- [ ] **Step 2: Update the README**

Add `docs/runbooks/` and `docs/10-whatsapp-templates.md` to the "Where things are"
table, and add this section after "The agent":

```markdown
## Reminders

Reminders are business-initiated, which WhatsApp only allows through a template
approved by Meta in advance. `docs/10-whatsapp-templates.md` has the exact text
to submit and tracks approval status.

Nothing runs on a timer inside the app. Point a scheduler at
`GET /api/cron/reminders` every 15 minutes and `GET /api/cron/purge` daily, both
with `Authorization: Bearer $CRON_SECRET`. Both refuse to run if `CRON_SECRET`
is unset.

A reminder re-checks the world immediately before sending: a cancelled
appointment, a discontinued prescription, or a patient who withdrew consent all
result in no message, however the reminder was scheduled.
```

- [ ] **Step 3: Update the roadmap**

In `docs/07-mvp-roadmap.md`, mark Phase 2 complete, and under Phase 3 note what remains:
the tabletop rehearsal, and a second clinic onboarded operationally.

- [ ] **Step 4: Run everything one final time**

```bash
npx tsx --env-file=.env.local scripts/migrate.ts
npx tsx --test --test-concurrency=1 --env-file=.env.local "tests/*.test.ts"
npx tsc --noEmit
npm run build
```

Record the actual test count in the log before committing. If `npm run build` fails,
fix it — a plan is not done while the app does not build.

- [ ] **Step 5: Commit**

```bash
git add docs README.md
git commit -m "docs: bring the log, README and roadmap up to date with Phase 2"
```

---

## Deferred — logged, not built

Per `docs/00` principle 2, recorded here instead of built:

- **Per-doctor availability.** Clinic hours are one shared 09:00–18:00 Mon–Sat range in
  `booking.ts`. The first clinic with doctors on different schedules turns this into a table.
- **A stronger model tier for ambiguous phrasing** (`docs/05` model routing). Haiku handles
  everything today; add the second tier when real conversations show where it falls short.
- **Refill reminders scheduled automatically from `duration_days`.** Task 5 builds
  `scheduleRefillFollowup`; nothing calls it yet on prescription creation. Wire it up once
  a real clinic confirms they want it, and decide the lead time with them rather than for them.
- **Multi-location clinics.** `docs/04` explicitly defers the join table.
- **Voice.** `docs/07` Phase 4, gated on Phase 2 running for a real clinic for 2–4 weeks.
- **Insurance, billing, lab reports, analytics.** Out of scope in `docs/01`.
- **Reminder localisation.** Templates are English only; a Hindi template is a second Meta
  submission, worth doing once the pilot clinic asks.
- **Unsupported inbound message types** (image, audio, location) reply to the patient and
  ping staff but create no `escalations` row, so they are invisible in the CRM inbox.
  Small fix; do it when someone actually sends a photo.

## Open questions for Ansh

These change the plan and only he can answer them:

1. **`ANTHROPIC_API_KEY`** — until it exists the agent escalates every message and the
   7 live classifier tests stay skipped, so the default `ANTHROPIC_MODEL` value is
   unverified. Task 11 covers the offline half; the live half needs the key.
2. **Meta business verification** — templates cannot be submitted until the WhatsApp
   Business Account exists, and approval takes days. Task 4 can be built now; nothing
   reaches a real patient until this clears.
3. **Retention window** — Task 10 uses 30 days before hard deletion. That is an
   engineering guess. Counsel should confirm it.
4. **Who is the incident lead** for `docs/runbooks/breach.md`, and who is the clinic-side
   contact.
