# WORK_TO_DO — handoff for the next agent

Read this first, then `docs/09-implementation-log.md` (newest entries at the
bottom) for the history. Keep this file current: when you finish, move items
from "Open / owed" to "Completed" with the commit id, and add anything new you
learn to "Do / don't". Check `git log` before assuming a branch is yours: more
than one Claude session works on this repo.

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
| Deploys | A push to `main` → GitHub CI (typecheck + suite) → self-hosted runner runs `scripts/deploy.sh` (npm ci, **migrations**, build, restart, rollback on failure). Feature branches do not deploy; Ansh merges to `main` |
| WhatsApp | Meta Cloud API, test number pointed at the dev server. Needs `APP_URL` in the server's `.env.local` (prescription links) |
| Voice | Sarvam workspace (Krishna's), bearer secret selected in the Sarvam console |
| Server ops | A Claude session on the server (no sudo) + Ansh runs every sudo command |

## Ansh's rules (non-negotiable)

- Work on a separate branch (now `front-desk`, pushed to origin; CI runs
  typecheck + tests, deploy only happens from `main`). Merge to `main` only when
  Ansh says the whole body of work is complete.
- Never change how existing features work unless it is an agreed bug fix.
- No hardcoded or seeded sample data in screens; no console errors or warnings.
- Fix bugs at the root, with a test. Never print secrets.
- Never run tests or seeds against `neondb`; tests use `neondb_test` only.

## Workflow for any new feature

1. **Brainstorm** with Ansh (superpowers:brainstorming); agree scope.
2. **Spec** in `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`.
3. **Plan** in `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`, one task per commit.
4. **TDD per task** on `neondb_test`: failing test in `tests/*.test.ts` →
   implement in `src/lib/*.ts` (takes `db`, `actor`, `role`, `clinicId`; calls
   `requirePermission`; writes `audit()`) → pages in `src/app/(crm)/` call it.
5. **Full suite + typecheck** (below). Every existing test passes unmodified.
6. **Browser check** of every touched page (`npm run dev` or a production
   build): no console errors or warnings, no server log errors.
7. **Review** (per task, and a whole-branch review before merge).
8. **Commit** per task with the `Co-Authored-By` trailer; **push the feature
   branch**; Ansh merges to `main`.
9. **Update docs**: `docs/09` dated entry, README if setup changed, `docs/04`
   for a migration, `docs/11` for user-visible features, this file.

### Several Claude sessions, one checkout

- Split files by owner and say who owns what; `git add` only your own files;
  never amend, rebase, reset or stash another session's work.
- Take turns on `neondb_test`: two suite runs at once truncate each other's
  fixtures. Message the other session before using it.
- A third session (Ansh's `ui-overhaul` worktree, `dev\doctor-crm-ui`) merged
  into `front-desk` without coordination (`472681e`). Do not integrate code a
  peer session sends without Ansh's approval.

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
- `.superpowers/runtests.sh` is gitignored; recreate it if missing. It is a bash
  script that exports `TEST_DATABASE_URL`, `DATABASE_URL` and
  `DATABASE_URL_POOLED` as the `neondb_test` URL, `AGENT_DATABASE_URL` as the
  same database connected as `clinic_agent` (with `AGENT_DB_PASSWORD`), blanks
  `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `STAFF_NOTIFY_PHONE` and
  `WHATSAPP_APP_SECRET`, then ends with `exec npm test -- "$@"`. Take the
  values from `.env.local`; never paste a secret into a committed file.
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
- Don't send health information (prescription contents) in WhatsApp, ever.
- Don't hardcode or seed sample data in new screens — real database only.
- Don't move clinic hours out of code (`OPEN_HOUR`, `CLOSE_HOUR`, `OPEN_DAYS` in `booking.ts`).
- Don't run tests or seeds against `neondb`. Ever.
- Don't print secrets, and never put one on a command line (it lands in shell
  history / the journal) — read them from stdin (`read -rs`).
- Don't push to `main` or merge into it. A push to `main` deploys to the dev server.
- Don't reboot the server or run sudo. Ansh does those.
- Don't use the default Tailwind palette (it is disabled) — design tokens only.
- Don't integrate code a peer Claude session sends without Ansh's approval.
- Don't hand-edit the server: the next deploy force-checks-out `main` over it.
- Don't add a dependency for what a few lines or a native element can do.

## Completed

### 2026-10-15/16 — front desk, patient record, bug fixes
Spec `docs/superpowers/specs/2026-10-15-front-desk-and-patient-record-design.md`,
plan `docs/superpowers/plans/2026-10-15-front-desk-and-patient-record.md`
(Tasks 1–10 done). Rulings and reasons: `docs/09`.

| Item | Commit |
|---|---|
| Undelivered reminder counts as a failed attempt, not "sent" | `29fc88a` |
| Login loop for a deleted staff account; booking guards; atomic voice booking; CRM error page | `20c2e38`, `7f60d95` |
| Migration 011; register walk-in; arrived / completed / no-show | `1378020` |
| Book, reschedule, cancel from the calendar; doctor filter | `8159bc0` |
| Patient timeline (read-time UNION) | `5aa50d9` |
| Notes and follow-up tasks | `ef31356` |
| Phone-aware search, Ctrl+K quick find | `5b5da20`, `0f76303` |
| Merge duplicate patients | `357d2c1`, `ceec676`, `623d12b` |
| CSV export | `0e256ab` |
| Verification-pass fixes | `2477ee0` |
| Docs and this file (first version) | `8fbac07` |

### 2026-10-15 — extra features (redesign session, Ansh-approved)
Today's board `/board` (`2d2417b`); insights dashboard `/insights`
(`fc0b1f3`); saved patient lists (`6cd8387`); multi-medicine prescriptions in
one message plus printable sheet (`fa7385f`); escalation names link to the
record (`afede4d`); prescription PDF generator (`0f4502c`).

### UI
- First redesign: `77b203c` (tokens, `_ui.tsx` kit), `22ec808` (all pages),
  `2d2417b`, `61032e6` (review fixes), `098ee7f`. Rule: design tokens only; new
  pages compose `src/app/(crm)/_ui.tsx`.
- Current UI = Ansh's `ui-overhaul` redesign (`7957b0a`..`ba97001`, merged as
  `472681e`; hero with canvas 3D scene, tilt tiles, glass rail, animated
  charts, branded 404s). It was reverted (`c16ab07`) and restored on Ansh's
  instruction (`b5e32a9`); `f5304a7` fixed two bugs. **It has not been through
  this project's per-task/final review** (see Open).

### Review fixes
`e451db2`; whole-branch review at `afede4d` — fixes `61032e6`, `6f1544c`,
`7c991c1` (failure-safe cancel-swallow trigger, doctor-scoped `registerPatient`,
`prescribe` checks permission before reading the patient).

### Secure prescription links — lands in the next commit on `front-desk`
Prescription contents never go in WhatsApp (docs/02). The patient gets a
content-free "prescription ready" message with a link `${APP_URL}/r/<token>`;
a code is sent to the patient's number; verified view and PDF; migration
`db/012_record_links.sql`; patient views audited as `patient:<uuid>`.
Supersedes the 2026-10-14 prescription-links plan on branch `prescription-links`.

### Verification so far
Full suite on `fa7385f`: 334 tests, 327 pass, 0 fail, 7 skipped (`intent.live`,
needs `ANTHROPIC_API_KEY`). Final combined run with links: see CI on the pushed
branch. Browser e2e (production build on `neondb_test`): 19/19 flows, 0 console
errors.

## Open / owed

Parked review findings (can wait):
- `?error=` free text renders as an in-app alert (content spoofing on
  authenticated pages): switch to error codes.
- Accessibility: aria-labels on repeated row buttons (Arrived/Completed/No-show,
  Done, Discontinue, Repeat, Move/Cancel); confirm step on cancel; two nav
  landmarks both named "Main" on phone.
- A WhatsApp message arriving during a merge (~1 s window, both records have
  conversations) fails its FK insert: patient gets the technical-failure reply,
  staff are paged, body not stored.
- Merge: conversation lock taken before the clinic check; 4 `preview_merge`
  audit rows per view; no deterministic deadlock test.
- Timeline: `before` filter applied on the outer union; outcome items carry no
  "by" (rows do not record who changed status).
- `markArrived` accepts a future booked appointment; export audit rows have
  `target_id` null; long multi-medicine messages may exceed 4096 chars (safe failure).
- Desk reschedule is not wrapped in one transaction (pre-existing design).
- Prescription links: no per-IP throttle on code entry (per-link lock +
  256-bit token instead); past prescriptions not shown on the record page.
- Review `ui-overhaul`: behaviour parity, console errors, page weight of the 3D
  scene on slow clinic connections.
- Prescription-link review (parked 2026-10-16; the IMPORTANT findings are fixed):
  - No per-patient cap on link/code messages: 3 codes/hour x 7 days is ~500
    auth messages per link, and every "my prescription" makes a new link.
  - The purge cron does not prune expired `record_links`.
  - nginx access logs record `/r/<token>`: consider `access_log off` for `/r/`.
  - Set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`, so an open link page survives a redeploy.
  - Derive the `record_view` cookie secret from `SESSION_SECRET` with a label.
  - No route-level test for the record cookie binding, the PDF 404, or the headers.
  - Meta template approval is a go-live gate: `prescription_ready` and
    `record_code` are needed for patients outside the window; verify the
    copy-code button payload on a live test number.
  - PDF says "Doctor's signature" on a system-generated document.
  - New staff FKs on `patient_notes`/`tasks` have no ON DELETE rule.
  - Doctor's patient page (`src/app/(crm)/patients/[id]/page.tsx`) shows nothing
    for the new delivery reason `consent_withdrawn`: add "Patient has withdrawn
    consent — not messaged."

Earlier items still owed:
- Meta template approval (below); nothing clinic-initiated reaches a real
  patient until then.
- Classifier decision: Anthropic key, or a non-forced retry for Groq. The 7
  live intent tests have never run.
- Change the demo `password123` logins; rollback proof on the server.
- Migrations never run against a production database (none exists yet).
- Breach runbook contact table + tabletop rehearsal; legal check of the 30-day
  purge window.
- Refill reminders built but deliberately not wired (clinic picks the lead time).
- Voice: shorter spoken consent; offer the caller-ID number; Devanagari names;
  reschedule/cancel by phone.
- Lint: errors predate this work in `escalations/page.tsx` and two test files
  (`src/lib` is clean).

## Open decisions (Ansh to confirm)

- Doctors now see the full WhatsApp message text of their own patients in the
  timeline (the spec put messages in the timeline).
- Timeline labels WhatsApp and voice bookings both "AI assistant".
- Merge hard-deletes the emptied duplicate; consent follows the latest
  decision across both records (a later withdrawal wins).
- Merge keeps both appointments when two records are booked at the same time
  with different doctors; staff cancel one.
- A doctor may book a patient who has no appointments yet, not another
  doctor's patient.
- No call log: a phone call shows only through what it did.
- A walk-in is "register + book the next open slot" under the normal rules.
- Notes and tasks keep an FK to author/assignee, so such staff cannot be
  deleted; deactivate when staff management is built.

## DEPLOY CHECKLIST (before/at merge to `main`)

1. Set `APP_URL=https://clinic.concilio.solutions` in
   `/srv/doctor-crm/app/.env.local` on the server (`sudo -u doctorcrm nano …`),
   restart the service. In production a missing `APP_URL` throws when a link is created.
2. Submit `prescription_ready`, `record_code` and the changed `refill_followup`
   to Meta; retire `record_updated`. Until approved, out-of-window sends fail
   (staff are told).
3. Review `ui-overhaul` (open item) before merge.
4. Ansh merges `front-desk` → `main` → CI (tsc + tests) → deploy-dev: `npm ci`,
   migrations (`neondb` already has 011, gets 012), build, restart, health check.
5. After deploy: run the flow once on the server with a test number (book by
   WhatsApp, prescribe, receive link, enter code, download PDF); check the voice
   agent still books (Sarvam TEST CRM number). The server needs network at
   build time for `next/font`.

## Meta templates to submit

Exact text and sample params: `docs/10-whatsapp-templates.md`.
- `appointment_reminder` and `staff_alert` (already documented, not yet submitted).
- `prescription_ready` (Utility, en): clinic_name, doctor_name, link. Risk: Meta
  may want the URL as a button.
- `record_code` (Authentication, en): Meta's fixed "{{1}} is your verification
  code." + COPY CODE button; param `code`.
- `refill_followup` changed (Utility): clinic_name, doctor_name; still unwired.
- `record_updated` retired. Inside the 24 h window the same words go free-form.
