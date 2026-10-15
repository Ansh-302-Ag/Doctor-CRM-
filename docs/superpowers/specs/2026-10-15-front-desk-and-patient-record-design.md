# Front desk, patient record and bug fixes — design

Date: 2026-10-15. Approved scope: conversation of 2026-10-15 (Ansh). Ideas
borrowed from twentyhq/twenty after a read of its source; Doctor-CRM
inventory from the same day.

## Why

Doctor-CRM's bots (WhatsApp, voice) can book, but the clinic's own staff
cannot do their basic job inside the CRM: the calendar is read-only, there is
no way to register a walk-in, nothing ever marks a visit completed or no-show
(so "seen" counts always read 0), and a patient's history is scattered. Twenty
is a general CRM; a few of its ideas — one timeline per record, notes, tasks,
quick find, merge duplicates, export — map well onto a clinic, translated
into patient terms. A short read of our code also found real bugs.

Success: a receptionist runs a full day (walk-ins, phone bookings typed in,
moves, cancellations, arrivals, no-shows) without leaving the CRM, and sees
any patient's whole story on one page — while everything the bots do today
keeps working exactly as it does now.

## Goals

1. **Bug fixes, root cause** (behaviour changes only in the broken case):
   - `runDueReminders`/`sendDue` marks a reminder `sent` when `sendTemplate`
     returned `{delivered:false}` (WhatsApp unconfigured). An undelivered
     reminder must not be recorded as sent (`src/lib/reminders.ts:135-139`,
     `src/lib/channel.ts:94-96`).
   - Login redirect loop when a staff row is deleted but its cookie is valid
     (`src/app/login/page.tsx:14`, `src/lib/session.ts:67`): the stale
     session must be cleared and the login page shown.
   - `ownedAppointment` (`src/lib/booking.ts:196-206`) ignores status:
     cancel/reschedule must refuse an appointment that is not `booked`.
   - `bookAppointment` must refuse a patient whose clinic differs from the
     doctor's clinic.
   - `voiceBook` (`src/lib/voice.ts`): consent + name + booking in one
     transaction; never overwrite an existing patient name (match WhatsApp,
     which only fills a missing name).
   - `Forbidden` from a server action renders as a 500: add a CRM
     `error.tsx` that shows a plain "not allowed" / "something went wrong"
     message.
2. **Front-desk actions** (staff, through the same `src/lib/booking.ts`
   functions the bots use, so the exclusion constraint and hours rules apply):
   - Book from the calendar: pick patient (search) or register new, doctor,
     day, open slot (from `checkAvailability`), optional reason.
   - Reschedule and cancel an appointment from the calendar / patient page.
   - Register a walk-in patient: name, phone (normalised as voice does,
     `normalisePhone`), consent taken at the desk → `recordConsent` with
     channel `desk`. Duplicate phone in the clinic → open the existing record,
     do not create a second.
   - Mark an appointment arrived / completed / no-show. "Arrived" is a new
     status; completed and no_show already exist in the enum.
   - Calendar filter by doctor (URL param, like `?day=`).
3. **Patient record** (borrowed from Twenty):
   - **Timeline**: one chronological feed on the patient page — appointments
     (booked, moved, cancelled, completed, no-show, who booked: AI / voice /
     staff), WhatsApp messages, escalations, prescriptions, consent events,
     notes, tasks. Built by a read-only query over the existing tables
     (UNION), not a new events table, so no existing write path changes.
     Paginated (newest first, "show older").
   - **Notes** on a patient: free text, author, time. New table.
   - **Follow-up tasks**: title, due date, assignee (staff user), done flag,
     linked to one patient. List on the patient page and a "My tasks" list.
     New table. Single `patient_id` FK (Twenty's multi-target join tables are
     overkill here).
   - **Quick find (Ctrl+K)**: anywhere in the CRM, type a name or a phone in
     any common Indian form (98…, +91 98…, 098…, 9198…) → jump to the patient.
     Uses the existing search, extended to match phones by their last 10
     digits.
   - **Merge duplicate patients**: pick two records of the same clinic, choose
     which to keep, see a preview of what moves (appointments, conversations,
     messages, prescriptions, reminders, escalations, notes, tasks), confirm.
     Loser is soft-deleted (existing `deleted_at`, existing purge applies).
     One transaction. Admin and receptionist only.
   - **CSV export** of patients and of a day/date range of appointments,
     respecting role scoping (a doctor exports only his patients). Audited.

## Non-goals

Custom fields/objects, workflow builder, email/calendar sync, kanban, dashboard
builder, saved views (the URL already is one), file attachments (storing
medical documents is a separate privacy decision), CSV import, per-doctor
hours, moving clinic hours into the database, reschedule/cancel by phone,
analytics beyond existing counts. UI/UX redesign comes after this work.

## Anti-goals (failure even if it "works")

- Any change in what the WhatsApp agent, voice agent, reminders, purge or
  webhook do today, other than the listed bug fixes. The existing test suite
  must pass unchanged (tests may be added, not weakened).
- Any hardcoded or sample data in new screens: everything new reads and writes
  the real database.
- Console errors or warnings in the browser or server log on any page.
- A staff action that bypasses the booking rules (hours, no double booking,
  consent) or the role matrix, or skips the audit log.
- The agent role (`clinic_agent`) gaining any new grant beyond what its own
  flows need (notes/tasks/merge are staff-only; the agent gets nothing on
  them).

## Constraints

- Stack as is: Next.js 16 App Router with server actions (read
  `node_modules/next/dist/docs` before writing Next code), raw SQL via
  `postgres`, numbered migrations in `db/` (next is `011`), Tailwind v4
  tokens, `node:test` suite.
- Migrations forward-only and safe on the live dev database (Neon
  `neondb`): adding an enum value, tables, columns, indexes only.
- DPDP: every read/write of patient data goes through `audit()`; consent
  before any booking (desk consent recorded with channel `desk`); soft-delete
  rules unchanged.
- RBAC via `src/lib/rbac.ts`. Doctors keep seeing only their own patients
  (`src/lib/patients.ts` scoping). New permissions added to the matrix, not
  checked ad hoc.
- Tests first for every business-logic function (booking from staff, merge,
  timeline, tasks, notes, search, export, each bug fix). Tests run against
  `neondb_test`, never `neondb`.
- Deploy only by the user's push to `main` after the full suite passes.

## Decided

- Timeline is a read-time UNION query, not an event table (Ansh approved the
  list; mechanism is the builder's call recorded here: it keeps every existing
  write path untouched).
- Notes and tasks: one table each, `patient_id` FK, `on delete cascade`
  (purge removes them with the patient).
- Desk consent: the receptionist ticks "patient agreed" after reading the
  notice aloud; recorded via `recordConsent(..., 'desk')`.
- "Arrived" is a new `appointment_status` value; arrived still blocks the slot
  (exclusion constraint condition widened to `status in ('booked','arrived')`
  — check the agent/voice code paths that filter on `status = 'booked'` and
  keep their behaviour identical for booked rows).
- Clinic hours stay in code (`OPEN_HOUR`, `CLOSE_HOUR`, `OPEN_DAYS`) — Ansh:
  do not touch existing working.

## Calls made after the builder check (Claude's, for Ansh to check)

- **Walk-in = register + book the next open slot under the normal rules.**
  No "seen now" bypass of `bookAppointment` (that would change shared booking
  rules). The desk sees the next open slots for the chosen doctor today.
- **Merge moves everything, including `consent_log`**, then **hard-deletes the
  emptied duplicate** (all its rows now belong to the kept record, so nothing
  personal is lost). The kept record's consent becomes `granted` if either
  record had granted. A later message or call from the duplicate's old number
  is then a new contact and goes through consent again — bots unchanged.
- **Undelivered reminder (`delivered:false`) counts as a failed attempt**: the
  existing back-off and, after three, the existing failure path (one
  escalation + one page). Not configuring WhatsApp is a deployment error staff
  should hear about.
- **Timeline shows one "AI assistant" label for WhatsApp and voice bookings.**
  Both bots write `created_by = 'agent'`; separating them would change a bot
  write path. Where a WhatsApp conversation exists, its messages appear in the
  timeline anyway.
- Timeline items follow existing permissions (a doctor does not see
  escalations, as today).

## Left to the builder

Exact page layout within the existing design tokens (polish comes later);
SQL shape of the timeline query; how merge previews are computed; task list
placement; CSV column choice; which role may export (default: admin and
receptionist all patients, doctor own patients).
