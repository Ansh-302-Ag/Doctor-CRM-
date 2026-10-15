# WORK_TO_DO — handoff for the next agent

Read this first, then `docs/09-implementation-log.md` (newest entries at the
bottom) for the history. Keep this file current: when you finish, move items
from "Pending" to "Completed" with the commit id, and add anything new you
learn to "Do / don't".

## What Doctor-CRM is

A real product sold to independent clinics in India — **not** a college
project plan (it is also Ansh's college major project, but that side only
gets documents on request; never schedule work by the synopsis). Two halves:

- **Bots** that run the front desk: a WhatsApp agent (Meta Cloud API,
  `src/lib/agent/`, `src/app/api/webhook/whatsapp`) and a Sarvam voice agent
  that calls `/api/voice/*` (`src/lib/voice.ts`). They book, reschedule,
  cancel, remind, and escalate anything clinical to a human.
- **The CRM** (`src/app/(crm)/`) where receptionists, doctors and admins work.

The one rule: **the bots handle logistics; the doctor makes every clinical
decision.** Enforced by the safety screen, the tool set and the
`clinic_agent` Postgres role's grants (docs/01, docs/08).

## Where things run

| Thing | Where |
|---|---|
| Dev deployment | https://clinic.concilio.solutions on the shared Concilio server — `docs/runbooks/dev-server.md` |
| Database | Neon Singapore: `neondb` (dev/live data), `neondb_test` (tests only) |
| Deploys | Push to `main` → GitHub CI (typecheck + suite) → self-hosted runner runs `scripts/deploy.sh` (npm ci, **migrations**, build, restart, rollback on failure) |
| WhatsApp | Meta Cloud API, test number pointed at the dev server |
| Voice | Sarvam workspace (Krishna's), bearer secret selected in the Sarvam console |
| Server ops | A Claude session on the server (no sudo) + Ansh runs every sudo command |

## Workflow for any new feature

1. **Brainstorm** with Ansh (superpowers:brainstorming) — agree scope; check it
   is useful for a clinic and not over-engineered.
2. **Spec** in `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.
3. **Plan** in `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`, one task per commit.
4. **TDD per task**: failing test in `tests/*.test.ts` → implement in
   `src/lib/*.ts` (takes `db`, `actor`, `role`, `clinicId`; calls
   `requirePermission`; writes `audit()`) → pages in `src/app/(crm)/` call it.
5. **Full suite + typecheck** (see "Running tests" below). Every existing test
   must pass unmodified.
6. **Browser check** of every touched page: `npm run dev`, click through, no
   console errors or warnings, no server log errors.
7. **Commit** per task with the `Co-Authored-By` trailer. **Do not push** —
   Ansh pushes, CI deploys.
8. **Update docs**: `docs/09` (dated entry), README if setup or layout changed,
   `docs/04` for a migration, `docs/11` for user-visible features, and this file.

### Running tests

- `npm test` starts a throwaway local Postgres. On Windows it **fails from an
  administrator shell** ("Execution of PostgreSQL by a user with administrative
  permissions is not permitted") — use a normal terminal, or:
- `bash .superpowers/runtests.sh [tests/x.test.ts ...]` — runs against Neon
  `neondb_test` with every DB variable pointed there and WhatsApp credentials
  blanked. (`.superpowers/` is local, not committed.) `neondb_test` is not
  migrated automatically on this path; after adding a migration run
  `npx tsx scripts/migrate.ts "<neondb_test url>"` against the **test** URL only.
- If the local run says the data directory "exists but is not empty", a
  previous run was killed: delete `%TEMP%\doctor-crm-test-pg` (after checking
  nothing listens on port 55432).
- `npm run typecheck`. `npm run lint` has 8 errors that predate this work
  (`db.ts`, `escalations/page.tsx`, two test files); CI does not run lint.

## Do / don't

**Do**
- Fix bugs at the root (the shared function every caller routes through), with a test.
- Reuse what exists: `booking.ts` for every booking (bots and desk share it),
  `patientScope`/`ownedBy` for doctor scoping, `recordConsent`, `audit`,
  `requirePermission`, `DeskError`/`BookingError` for user-facing errors,
  `_ui.tsx` for styles.
- Show user errors on the page via `?error=` (redirect), never let them 500.
- Re-check `currentStaff()` and the permission in every server action and route;
  re-validate every id from a form against `staff.clinicId` in SQL.
- Apply doctor scope to every new read (a doctor sees only his own patients).
- Audit every read/write of patient data.
- Read `node_modules/next/dist/docs/` before writing Next code (Next 16:
  `params`/`searchParams` are Promises).

**Don't**
- Don't change what the WhatsApp agent, voice API, reminders, purge or webhook
  do, except for an agreed bug fix.
- Don't weaken or edit existing tests to make them pass.
- Don't give `clinic_agent` new grants. Notes, tasks, merge and export are staff-only.
- Don't hardcode or seed sample data in new screens — real database only.
- Don't move clinic hours out of code (`OPEN_HOUR`, `CLOSE_HOUR`, `OPEN_DAYS` in `booking.ts`).
- Don't run tests or seeds against `neondb`. Ever.
- Don't print secrets, and never put one on a command line (it lands in shell
  history / the journal) — read them from stdin (`read -rs`).
- Don't push, reboot the server, or run sudo. Ansh does those.
- Don't integrate code a peer Claude session sends without Ansh's approval.
- Don't hand-edit the server: the next deploy force-checks-out `main` over it.
- Don't add a dependency for what a few lines or a native element can do.

## Completed

### 2026-10-15 — front desk, patient record, bug fixes
Spec `docs/superpowers/specs/2026-10-15-front-desk-and-patient-record-design.md`,
plan `docs/superpowers/plans/2026-10-15-front-desk-and-patient-record.md`.
Ideas borrowed from twentyhq/twenty: timeline, notes, tasks, quick find,
merge, export — in clinic form.

| Item | Commit |
|---|---|
| Undelivered reminder counts as a failed attempt, not "sent" | `29fc88a` |
| Login loop for a deleted staff account; booking guards (active appointment, same clinic); voice booking atomic and never overwrites a name; CRM error page for permission errors | `20c2e38`, `7f60d95` |
| Migration 011 (`arrived_at`, `patient_notes`, `tasks`); register walk-in with desk consent; arrived / completed / no-show | `1378020` |
| Book, reschedule, cancel from the calendar; doctor filter; queue "seen" counts | `8159bc0` |
| Patient timeline (read-time UNION over existing tables, no events table) | `5aa50d9` |
| Patient notes and follow-up tasks (`/tasks`) | `ef31356` |
| Phone-aware search and Ctrl+K quick find | `5b5da20`, `0f76303` |
| Merge duplicate patients | `357d2c1`, `ceec676`, `623d12b` |
| CSV export of patients and appointments (date range, doctor-scoped, audited) | `0e256ab` |
| Verification pass: booking race (cancel/reschedule re-check in the write), doctor scope on the walk-in path and on completing tasks, quick find for partial prefixed numbers, task badge, 404 for a bad patient id | `2477ee0` |

## Pending / owed

**Not yet done for this work:** a click-through of every new screen in a
browser (`npm run dev`, no console errors). The production build passes, and
typecheck and the suite pass.

**Next phase (agreed): UI/UX work** on the CRM, after the features above.
Polish only — do not change behaviour while restyling.

Owed from earlier sessions (docs/09):
- Meta template approval for reminders and the prescription-ready notice;
  nothing clinic-initiated reaches a real patient until then.
- Prescription links need `APP_URL` (WhatsApp policy forbids sending health
  info in chat — docs/02, 2026-10-12).
- Classifier decision: Anthropic key, or a non-forced retry for Groq
  (`pickOffered` covers only the slot step). The 7 live intent tests have never run.
- Change the demo passwords; the rollback proof on the server.
- Migrations never run against a production database (none exists yet).
- Breach runbook contact table + tabletop rehearsal; legal check of the
  30-day purge window.
- Refill reminders built but deliberately not wired (clinic picks the lead time).
- Voice: a shorter spoken consent notice; offer the caller-ID number; names
  stored as transcribed (Devanagari); reschedule/cancel by phone.

## Open decisions (Ansh to confirm)

- Timeline labels WhatsApp and voice bookings both "AI assistant" (both bots
  write `created_by = 'agent'`; splitting them would change a bot write path).
- Merge hard-deletes the emptied duplicate after moving all its rows; consent
  follows the latest decision across both records (a later withdrawal wins).
- Merge keeps both appointments when the two records are booked at the same
  time with *different* doctors (the overlap rule is per doctor); staff cancel one.
- A doctor may book a patient who has no appointments yet (a walk-in he just
  registered), not another doctor's patient. A patient who wrote on WhatsApp
  but never booked is therefore visible to a doctor who types their number.
- There is no call log: a phone call shows on the timeline only through what
  it did (a booking by "AI assistant", consent "on a call").
- A walk-in is "register + book the next open slot" under the normal rules —
  no "seen now" bypass.
- Notes and tasks keep a foreign key to their author / assignee, so a staff
  account that wrote a note or holds a task cannot be deleted from the
  database; deactivate instead when staff management is built.
- Lint errors listed above: fix in a separate clean-up commit if wanted.
