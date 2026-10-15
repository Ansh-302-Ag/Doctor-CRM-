# Front desk, patient record and bug fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let clinic staff run the whole front desk inside the CRM and see each patient's full story on one page, fix the bugs found on 2026-10-15, and change nothing else the bots do.

**Architecture:** New business logic lives in small `src/lib/*.ts` modules that take a `Db` handle, an `Actor`, a `Role` and a `clinicId`, check `requirePermission`, write through `audit()`, and are tested in `tests/*.test.ts` against `neondb_test`. Pages under `src/app/(crm)/` call them from server components and server actions. Staff booking reuses `bookAppointment` / `rescheduleAppointment` / `cancelAppointment` unchanged in shape. The timeline is a read-only UNION over existing tables. One migration (`db/011_front_desk.sql`).

**Tech Stack:** Next.js 16.3.4 App Router (server components + server actions; read `node_modules/next/dist/docs/` before writing Next code), TypeScript, `postgres` raw SQL, Tailwind v4 tokens (existing classes in `src/app/(crm)/_ui.tsx`), `node:test` via `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-15-front-desk-and-patient-record-design.md`

## Global Constraints

- Existing behaviour of the WhatsApp agent, voice API, reminders (except the delivered:false fix), purge and webhook must not change. Every existing test must pass unmodified; tests may be added, never weakened.
- No hardcoded or sample data in new code: every screen reads/writes the real database; the clinic comes from `currentStaff().clinicId`, doctors from the `doctors` table.
- No browser console errors/warnings and no server log errors on any page.
- Every read/write of patient data calls `audit()`. Every new lib function calls `requirePermission`.
- Doctor scope: a doctor sees only patients with an appointment with him (`patientScope` in `src/lib/patients.ts`); apply it to every new read.
- `clinic_agent` gets **no** new grants. Notes, tasks, merge and export are staff-only.
- Clinic hours stay in code (`OPEN_HOUR`, `CLOSE_HOUR`, `OPEN_DAYS` in `src/lib/booking.ts`).
- Status semantics: "arrived" is a timestamp `appointments.arrived_at`; the appointment status stays `booked`. This keeps the exclusion constraint and every bot query (`status = 'booked'`) untouched. Completed / no-show set `status` to `completed` / `no_show` (existing enum values).
- Desk consent: `recordConsent(db, actor, patientId, "granted", "desk")`.
- Notes: front-desk notes, append-only (no edit, no delete), visible to any staff who can see the patient.
- Tests run with `bash .superpowers/runtests.sh [files]` (points every DB variable at `neondb_test`, blanks WhatsApp creds). Never run tests against `neondb`.
- Commit after each task with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.

## Review Focus

- Booking a slot in the past or outside hours from the desk must show the `BookingError` message on the page, not a 500.
- Two staff booking the same slot at once: the second gets "that slot was just taken" (exclusion constraint → `slot_taken`).
- Merge where both patients have a WhatsApp conversation (unique `(patient_id, channel)`): messages must end up in one conversation, nothing lost.
- Phone search with spaces/dashes/prefix (`+91 98765-43210`, `098765 43210`) must find `+919876543210`.
- A doctor opening `/patients/<id>` of a patient outside his scope, or exporting, sees nothing of that patient (404 / excluded rows).

---

### Task 1: Undelivered reminder is a failed attempt, not "sent"

**Files:**
- Modify: `src/lib/reminders.ts` (`sendDue`, ~line 134)
- Test: `tests/reminders.test.ts`

**Interfaces:** Consumes `sendTemplate` result `{ delivered: boolean }` (`src/lib/channel.ts:86`).

- [ ] **Step 1: Write the failing test** `"an undelivered reminder (WhatsApp unconfigured) is retried, not marked sent"`: schedule a due reminder, run with a `send` stub returning `{ delivered: false }`; assert result `sent === 0`, row `status === 'scheduled'`, `attempts === 1`, `last_error` matches `/not delivered/`, `send_at > now`.
- [ ] **Step 2: Run** `bash .superpowers/runtests.sh tests/reminders.test.ts` — expect that test FAIL.
- [ ] **Step 3: Implement** — in `sendDue`, after `await send(...)`, if the result's `delivered` is `false` throw `new Error("not delivered: WhatsApp is not configured")` so the existing catch/back-off/failure path handles it.
- [ ] **Step 4: Run** the file — all PASS (existing reminder tests unchanged).
- [ ] **Step 5: Commit** `fix(reminders): an undelivered reminder is a failed attempt, not sent`

### Task 2: Login loop, booking guards, voice transaction, CRM error page

**Files:**
- Modify: `src/app/login/page.tsx:14`, `src/lib/booking.ts` (`ownedAppointment`, `bookAppointment`), `src/lib/voice.ts` (`voiceBook`), `src/app/api/voice/book/route.ts`
- Create: `src/app/(crm)/error.tsx`
- Test: `tests/booking.test.ts`, `tests/voice.test.ts`

**Interfaces:** Produces new `BookingErrorCode` values `"not_active"` and `"wrong_clinic"`. `voiceBook(db: Pool, ...)` (was `Db`): its writes (patient insert, consent, name, booking) run in `db.begin(tx => …)`; a `slot_taken` inside the transaction is rethrown so everything rolls back, and the alternatives are computed afterwards with the pool. The route passes `agentSql` as today.

- [ ] **Step 1: Failing tests**
  - booking: `"cancel and reschedule refuse an appointment that is not booked"` — cancel an appointment, then `cancelAppointment` again and `rescheduleAppointment` on it reject with `BookingError` code `not_active`.
  - booking: `"a patient cannot be booked with another clinic's doctor"` — `bookAppointment` with `f.patientId` and the fixture's other-clinic doctor rejects with code `wrong_clinic`.
  - voice: `"voice booking keeps an existing patient name"` — patient `+919000000001` (seed name "Asha") books via `voiceBook` with `name: "Someone Else"`; name stays `Asha`.
  - voice: `"a voice booking that loses the race leaves no patient or consent behind"` — stub the race by booking the slot directly between `voiceBook`'s availability check and its insert is impractical; instead call `voiceBook` with `now` such that the slot passes the check, after inserting a conflicting `booked` appointment with status set by a raw `insert` that the check cannot see is also impractical — so test the observable contract: make `bookAppointment` fail inside `voiceBook` by booking a new phone for a slot already taken *after* the availability read (use the `now` param and a second concurrent `voiceBook` for the same slot via `Promise.all`); assert exactly one `booked:true`, and the loser's phone has no `patients` row and no `consent_log` row.
- [ ] **Step 2: Run** both files — new tests FAIL.
- [ ] **Step 3: Implement**
  - `ownedAppointment`: after the ownership check, `if (a.status !== "booked") throw new BookingError("not_active", "that appointment is no longer active")`.
  - `bookAppointment`: select the patient's `clinic_id`; if it differs from `doctor.clinic_id` throw `new BookingError("wrong_clinic", "that patient belongs to another clinic")`.
  - `voiceBook`: writes inside `db.begin`; set the name only when the stored name is null (`update patients set name = $name where id = $id and name is null`, audited as `set_patient_name` only when a row changed).
  - Login page: when `session.user` exists, redirect only if `select 1 from staff_users where id = $id` returns a row; otherwise render the form (signIn overwrites the stale cookie).
  - `src/app/(crm)/error.tsx`: client component (`"use client"`), shows "You are not allowed to do that." when `error.message` starts with `role '` (Forbidden text) else "Something went wrong.", with a "Try again" button calling `reset()` and a link home.
- [ ] **Step 4: Run** `bash .superpowers/runtests.sh tests/booking.test.ts tests/voice.test.ts tests/agent.test.ts tests/safety.test.ts` — all PASS.
- [ ] **Step 5: Commit** `fix: booking guards, voice booking atomic, login loop, CRM error page`

### Task 3: Migration 011 and the desk library (register, arrive, outcome)

**Files:**
- Create: `db/011_front_desk.sql`, `src/lib/desk.ts`, `tests/desk.test.ts`
- Modify: `src/lib/rbac.ts`, `tests/helpers.ts` (`reset()` truncates the new tables)

**Interfaces:**
- Produces permissions `"patients:write"` (STAFF), `"patients:merge"` (receptionist, admin), `"tasks:write"` (STAFF).
- Produces in `src/lib/desk.ts`:
  - `registerPatient(db: Db, actor: Actor, role: Role, clinicId: string, input: { name: string; phone: string; consent: boolean }): Promise<{ id: string; existing: boolean }>` — `normalisePhone` (import from `./voice`); existing (clinic, phone) row returns `existing: true` untouched; new row inserted with name, and `recordConsent(..., "granted", "desk")` when `consent` true. Throws `DeskError("name required" | "consent required")` — consent is required to register.
  - `markArrived(db, actor, role, clinicId, appointmentId): Promise<void>` — sets `arrived_at = now()` on a `booked` appointment of this clinic; else `DeskError("not_active")`.
  - `setOutcome(db, actor, role, clinicId, appointmentId, outcome: "completed" | "no_show"): Promise<void>` — only from `booked` (else `DeskError("not_active")`); `completed` allowed at any time; `no_show` only once `starts_at <= now()` (else `DeskError("not started yet")`). Cancels its scheduled reminders (`cancelReminders`).
  - `export class DeskError extends Error`.
- Migration 011 contents: `alter table appointments add column arrived_at timestamptz;` `create table patient_notes (id uuid pk default gen_random_uuid(), patient_id uuid not null references patients(id) on delete cascade, body text not null check (length(trim(body)) > 0), created_by uuid not null references staff_users(id), created_at timestamptz not null default now()); create index on patient_notes (patient_id, created_at);` `create table tasks (id uuid pk, clinic_id uuid not null references clinics(id) on delete cascade, patient_id uuid references patients(id) on delete cascade, title text not null check (length(trim(title)) > 0), due_on date, assigned_to uuid references staff_users(id), done_at timestamptz, created_by uuid not null references staff_users(id), created_at timestamptz not null default now()); create index on tasks (clinic_id, done_at, due_on); create index on tasks (patient_id);` No grants to `clinic_agent`.

- [ ] **Step 1: Failing tests** in `tests/desk.test.ts`: register new (consent row channel `desk`, audit row `register_patient`); register duplicate phone in another format returns `existing: true` and the same id; register without consent throws; `markArrived` sets `arrived_at`, status stays `booked`, refuses a cancelled appointment and another clinic's appointment; `setOutcome('completed')` sets status and cancels the scheduled reminder; `setOutcome('no_show')` on a future appointment throws; agent role (`clinic_agent`, `agentDb`) cannot `select` from `patient_notes` / `tasks` (permission denied).
- [ ] **Step 2: Run** — FAIL (module missing).
- [ ] **Step 3: Implement** migration, rbac entries, `desk.ts`; add the two tables to `reset()`; run `npx tsx --env-file=.env.local scripts/migrate.ts "<neondb_test url>"` via the test runner (it migrates `neondb_test` itself if the runner does; otherwise run migrate against the TEST url only).
- [ ] **Step 4: Run** `bash .superpowers/runtests.sh` (full suite) — all PASS.
- [ ] **Step 5: Commit** `feat(desk): register walk-ins, mark arrived/completed/no-show`

### Task 4: Calendar actions and staff booking pages

**Files:**
- Modify: `src/app/(crm)/page.tsx` (doctor filter `?doctor=<id>`, per-row actions), `src/app/(crm)/queue/page.tsx` (arrived/complete/no-show buttons on the doctor's rows; "Seen" now real)
- Create: `src/app/(crm)/appointments/new/page.tsx` (book: `?patient=&doctor=&day=`), `src/app/(crm)/appointments/[id]/page.tsx` (reschedule / cancel), `src/app/(crm)/patients/new/page.tsx` (register walk-in, then go to book)
- Test: `tests/desk.test.ts` (staff booking through `bookAppointment` with a staff actor records `created_by = staff id`)

**Interfaces:** Consumes Task 3 `registerPatient`, `markArrived`, `setOutcome`, `DeskError`; existing `checkAvailability(db, doctorId, day)`, `bookAppointment(db, {kind:"staff", id}, role, {...})`, `rescheduleAppointment`, `cancelAppointment`, `BookingError`.

- [ ] **Step 1: Failing test** `"a staff booking is recorded as made by that staff member"`.
- [ ] **Step 2: Run** — FAIL only if the actor path is wrong (otherwise it passes immediately; keep it as a regression pin).
- [ ] **Step 3: Implement pages.** Rules: server actions re-check `currentStaff()` and permission; patient/appointment ids from forms are re-validated against `staff.clinicId` in SQL; `BookingError`/`DeskError` messages are shown on the page via a `?error=` param (no throw → no 500); slot list comes from `checkAvailability`; doctor list from `select id, name from doctors where clinic_id = $clinicId order by name`; calendar shows `arrived` as a badge when `arrived_at` is set; cancelled appointments stay visible (greyed) under the filter. Doctor role: queue gets arrived/completed/no-show for his own appointments only. Use `revalidatePath` after each action.
- [ ] **Step 4: Verify in the browser** (dev server, `/` → book → reschedule → cancel → arrive → complete; walk-in → book) with `read_console_messages` showing no errors; full test suite PASS.
- [ ] **Step 5: Commit** `feat(crm): book, reschedule, cancel, walk-ins and visit outcomes from the desk`

### Task 5: Patient timeline

**Files:**
- Create: `src/lib/timeline.ts`, `tests/timeline.test.ts`
- Modify: `src/app/(crm)/patients/[id]/page.tsx` (replace the "last 20 appointments" list with the timeline; keep prescriptions section and its actions as they are)

**Interfaces:**
- Produces `type TimelineItem = { at: Date; kind: "appointment" | "message" | "escalation" | "prescription" | "consent" | "note" | "task"; title: string; detail: string | null; by: "agent" | "staff" | "patient" | null; byName: string | null; refId: string }`
- `getTimeline(db: Db, actor: Actor, role: Role, clinicId: string, patientId: string, opts: { before?: Date; limit?: number; doctorId?: string | null }): Promise<TimelineItem[]>` — one `union all` query, newest first, default `limit` 50, `before` for "show older". Escalations included only when `can(role, "escalations:read")`. Returns `[]` for a patient outside clinic/doctor scope. One `audit(..., "read_timeline", "patients", patientId)`.
- Appointment titles: booked / moved / cancelled / completed / no-show / arrived, with doctor name and local time; `by` from `created_by` (`agent` → "AI assistant", else staff name via join).

- [ ] **Step 1: Failing tests**: items from each source appear in time order; `before` pages correctly; receptionist sees escalation, doctor does not; another clinic's patient returns `[]`; a doctor out of scope gets `[]`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**. **Step 4: Run** full suite + open a patient page in the browser, no console errors. **Step 5: Commit** `feat(patients): one timeline per patient`

### Task 6: Notes and follow-up tasks

**Files:**
- Create: `src/lib/notes.ts`, `src/lib/tasks.ts`, `tests/notes-tasks.test.ts`, `src/app/(crm)/tasks/page.tsx`
- Modify: `src/app/(crm)/patients/[id]/page.tsx` (add-note form, task form and open tasks), `src/app/(crm)/layout.tsx` / `_nav.tsx` (nav item "Tasks" with open-count badge for my tasks)

**Interfaces:**
- `addNote(db, actor, role, clinicId, patientId, body: string): Promise<{ id: string }>` — permission `patients:write`; patient must be in clinic (and doctor scope via `doctorId` param); empty body → `DeskError("note is empty")`.
- `createTask(db, actor, role, clinicId, input: { title: string; patientId?: string | null; dueOn?: string | null; assignedTo?: string | null }): Promise<{ id: string }>` — `tasks:write`; `assignedTo` must be a staff user of this clinic; `dueOn` validated `YYYY-MM-DD`.
- `completeTask(db, actor, role, clinicId, taskId): Promise<void>`; `listTasks(db, actor, role, clinicId, filter: { assignedTo?: string; patientId?: string; open?: boolean }): Promise<Task[]>`.
- Timeline (Task 5) already reads `patient_notes` and `tasks`.

- [ ] **Step 1: Failing tests**: note added and listed in timeline; empty note refused; note on another clinic's patient refused; task assigned to another clinic's staff refused; `completeTask` sets `done_at`; `listTasks({assignedTo, open:true})` excludes done; agent DB role denied.
- [ ] **Steps 2–4**: run FAIL → implement → full suite + browser check. **Step 5: Commit** `feat: patient notes and follow-up tasks`

### Task 7: Phone-aware search and Ctrl+K quick find

**Files:**
- Modify: `src/lib/patients.ts` (`searchPatients` match), `src/app/(crm)/patients/page.tsx` (exactly one result → redirect to it when `?jump=1`)
- Create: `src/app/(crm)/_quickfind.tsx` (client), mount in `src/app/(crm)/layout.tsx`
- Test: `tests/patients.test.ts`

**Interfaces:** `searchPatients` signature unchanged. Phone match: when the query has ≥4 digits, also match `right(regexp_replace(p.phone, '\D', '', 'g'), 10) like '%' || right(<query digits>, 10) || '%'`. Quick find: Ctrl/⌘+K (and `/` when no input is focused) opens a `<dialog>` with one input; Enter navigates to `/patients?q=<text>&jump=1`; Esc closes.

- [ ] **Step 1: Failing tests**: `"+91 90000-00001"`, `"090000 00001"`, `"9000000001"` each find Asha; existing name search tests still pass.
- [ ] **Steps 2–4**: FAIL → implement → full suite + browser: Ctrl+K from calendar, type a phone, lands on the patient; no console errors. **Step 5: Commit** `feat: phone-aware search and Ctrl+K quick find`

### Task 8: Merge duplicate patients

**Files:**
- Create: `src/lib/merge.ts`, `tests/merge.test.ts`, `src/app/(crm)/patients/[id]/merge/page.tsx`

**Interfaces:**
- `previewMerge(db, actor, role, clinicId, keepId, dropId): Promise<MergeCounts>`; `mergePatients(pool: Pool, actor, role, clinicId, keepId, dropId): Promise<MergeCounts>` — runs in `pool.begin`. `MergeCounts = { appointments: number; conversations: number; messages: number; prescriptions: number; reminders: number; escalations: number; consents: number; notes: number; tasks: number }`.
- Permission `patients:merge`. Both patients in `clinicId`, not deleted, `keepId !== dropId` else `DeskError`.
- Steps inside the transaction: move `appointments`, `prescriptions`, `reminders`, `escalations`, `consent_log`, `patient_notes`, `tasks` (`update … set patient_id = keep where patient_id = drop`); conversations: for each drop conversation, if keep has one on the same channel move its `messages` (and escalations' `conversation_id`) into keep's conversation and delete the drop conversation, else re-point the conversation; keep's `name` = coalesce(keep.name, drop.name); keep consent = `granted` if either is granted (with the latest `consent_recorded_at`); then `delete from patients where id = drop`; `audit(..., "merge_patients", "patients", keepId)` with a second audit row for `dropId`.

- [ ] **Step 1: Failing tests**: preview counts match; after merge every row belongs to keep and drop no longer exists; both-have-WhatsApp-conversation case keeps all messages in one conversation; consent becomes granted if drop had it; other clinic's patient refused; doctor role refused; exclusion constraint conflict (both booked with the same doctor at the same time) is impossible by construction — assert merge still succeeds when their bookings don't overlap and is rejected cleanly (`DeskError`) when they do.
- [ ] **Steps 2–4**: FAIL → implement (page: choose the other record by search, show preview, confirm button) → full suite + browser. **Step 5: Commit** `feat: merge duplicate patients`

### Task 9: CSV export

**Files:**
- Create: `src/lib/export.ts`, `tests/export.test.ts`, `src/app/(crm)/export/patients/route.ts`, `src/app/(crm)/export/appointments/route.ts`
- Modify: `src/app/(crm)/patients/page.tsx` and `src/app/(crm)/page.tsx` (download links)

**Interfaces:** `toCsv(rows: Record<string, unknown>[], columns: string[]): string` (RFC 4180 quoting; cells starting with `= + - @` prefixed with `'` against formula injection); `exportPatients(db, actor, role, clinicId, doctorId?)`, `exportAppointments(db, actor, role, clinicId, from: string, to: string, doctorId?)` returning CSV strings, each audited (`export_patients`, `export_appointments`). Routes use `currentStaff()`, reply `text/csv; charset=utf-8` with `Content-Disposition: attachment`. Range max 92 days.

- [ ] **Step 1: Failing tests**: quoting of commas/quotes/newlines; formula prefix; doctor export contains only his patients; range over 92 days refused.
- [ ] **Steps 2–4**: FAIL → implement → full suite + download both in the browser. **Step 5: Commit** `feat: CSV export of patients and appointments`

### Task 10: Docs and the handoff file

**Files:**
- Create: `WORK_TO_DO.md` (repo root)
- Modify: `README.md` ("Where things are", new "Front desk" section), `docs/09-implementation-log.md` (dated entry), `docs/04-database-schema.md` (011), `docs/11-product-overview.md` (new features), `docs/07-mvp-roadmap.md` (what moved from deferred to done), `docs/runbooks/dev-server.md` (migration 011 note if needed)

`WORK_TO_DO.md` sections: what Doctor-CRM is (product, not college); where things run (dev server, Neon, Sarvam, Meta); the workflow for any new feature (brainstorm → spec in `docs/superpowers/specs` → plan in `docs/superpowers/plans` → TDD per task against `neondb_test` → full suite → browser check with no console errors → commit → user pushes → CI deploys); do / don't (the Global Constraints above plus: never print secrets, secrets never on a command line, no server reboot, no push without the user, peer-session code needs approval, never seed or test against `neondb`, hand edits on the server are reverted by deploy); completed (with commit ids); pending / owed (from docs/09 "Still owed" and voice items); open decisions.

- [ ] **Step 1**: write/update the files. **Step 2**: `npm run typecheck` and full suite PASS. **Step 3: Commit** `docs: front desk features, handoff file WORK_TO_DO.md`
