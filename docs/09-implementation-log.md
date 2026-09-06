# Implementation Log

The running record of what has actually been built, what was decided while
building it, and what is deliberately not done yet. Docs 00–08 say what the
system should be; this file says what it currently is.

Append to the top of "Session log" as work happens. Do not silently revise
an earlier entry — add a new one saying what changed and why.

---

## Status at a glance

| Phase (docs/07) | State |
|---|---|
| Phase 0 — foundations | **Done**, verified against a real Postgres |
| Phase 1 — WhatsApp booking loop | **Done**, verified end to end via a local simulator |
| Phase 2 — prescriptions + refill reminders | Prescriptions **done**; refill reminders **built, not wired** (deliberate — see "Not built yet, on purpose") |
| Phase 3 — second clinic + hardening | **Partly done** — load test and tenant isolation covered; tabletop rehearsal outstanding |
| Phase 4 — voice | Not started, and deliberately so |

**143 tests: 136 passing, 7 skipped** against a real Postgres. The 7 skipped
are the live Anthropic API tests in `tests/intent.live.test.ts`, which skip
without `ANTHROPIC_API_KEY` and have still never been run, so the default
`ANTHROPIC_MODEL` value remains unverified. All six items on the docs/08
testing bar are now covered, including the last one (a reminder for a
discontinued prescription must not send — `tests/reminders.test.ts`).

---

## What exists

```
db/                    numbered SQL migrations, applied in order
  001_init.sql         the docs/04 schema + the double-booking exclusion constraint
  002_agent_role.sql   the clinic_agent Postgres role and its grants (docs/08)
  003_clinic_phone.sql the clinic's own number, quoted in every escalation reply
  004_agent_patient_intake.sql  lets the agent register a first-time caller
  005_review_fixes.sql the agent-role select grant on reminders, and other review fixes
  006_reminders_and_templates.sql  reminders/templates schema (Phase 2)
  007_escalations_nullable_conversation.sql  conversation_id made nullable (see below)
  008_appointments_patient_cascade.sql  on delete cascade on appointments.patient_id
  009_login_throttle.sql  login_attempts table backing throttle.ts

src/lib/
  db.ts                two pools: the app role, and the agent's restricted role
  password.ts          scrypt via node:crypto — no auth dependency
  rbac.ts              the docs/08 role matrix, written once
  audit.ts             append-only "who did what" writes
  consent.ts           versioned notice, consent gate, DPDP withdrawal path,
                       purgeDeletedPatients for the retention purge job
  booking.ts           availability, book, reschedule, cancel, ownership checks
  escalations.ts       the staff side of the escalation queue
  auth.ts / session.ts staff login and the signed session cookie
  channel.ts           outbound WhatsApp, or console when unconfigured
  webhook.ts           signature verification and payload parsing
  prescriptions.ts     create/list/discontinue — doctor and admin only, clinic-scoped
  patients.ts          patient search, record summary, name capture
  templates.ts         WhatsApp template definitions and rendering
  reminders.ts         scheduling, send-time re-validation, retry with backoff, escalation
  throttle.ts          login lockout keyed on email
  cron-auth.ts         shared CRON_SECRET guard for the scheduler endpoints
  agent/
    screen.ts          the deterministic safety screen + templated replies
    intent.ts          Anthropic Messages API — intent + doctor + day + slot
    tools.ts           the entire tool set (docs/05) and nothing else
    index.ts           the conversation state machine; now asks for and records a
                       patient's name

src/app/
  login/               staff sign-in
  (crm)/               calendar + escalation inbox, behind the session check
  (crm)/patients/      patient list and patient record (prescription entry)
  api/webhook/whatsapp route handler: verify, parse, handle, reply, notify
  api/cron/reminders   scheduler endpoint, guarded by cron-auth.ts
  api/cron/purge       retention purge endpoint, guarded by cron-auth.ts

scripts/
  migrate.ts           applies pending db/*.sql, one transaction each
  seed.ts              a clinic, two doctors, three staff logins
  sim.ts               terminal WhatsApp simulator against the real agent

tests/                 143 tests: booking, safety, agent, screen, dates, webhook,
                       prescriptions, patients, templates, reminders, throttle,
                       intent, multi-clinic, consent-purge, load
```

## Decisions made while building

**One Next.js app, not three services.** Docs/03 describes agent, backend and
CRM as separate layers. They deploy as one app: at one clinic, three deploys
buy nothing and cost operational attention.

Be precise about what the boundary actually is, because an earlier version of
this paragraph overclaimed. The *tool set* is the boundary: every booking,
cancellation, escalation and prescription read the agent performs goes through
`src/lib/agent/tools.ts`, which enforces the docs/08 role matrix and writes the
audit trail. It is not a data-access boundary — `src/lib/agent/index.ts` reads
and writes `messages`, `conversations` and `patients` with its own SQL, because
conversation plumbing is the agent's own concern and has no tool. Splitting the
agent into its own service later would mean moving that plumbing too, not just
moving files.

**No ORM.** Numbered SQL files and a 40-line runner. The schema's most
important feature is a GiST exclusion constraint, which is exactly the kind of
thing ORMs make harder to express and easier to lose in a migration.

**The safety screen is deterministic and runs before any model.** `screen()`
is keyword and regex matching, with no model in the path, and its verdict
cannot be overridden downstream. The reason is in docs/01: the escalation rule
has to hold on the day the model is having a bad day. A test asserts the
classifier is never even called for a clinical message.

**Everything after the screen is the model.** One call to the Anthropic
Messages API (Haiku tier, forced tool use) returns intent, doctor, day and
which offered slot the patient picked. Its output is range-checked before use:
a doctor who does not work here, a malformed date, or an out-of-range slot
index all become null, which costs one extra question instead of booking the
wrong thing. Without `ANTHROPIC_API_KEY`, or if the API errors or times out,
every message escalates to a human — there is no silent fallback path.

**The agent connects to Postgres as its own role.** `AGENT_DATABASE_URL` uses
`clinic_agent`, so the docs/08 grants bind at runtime rather than being a
comment in a migration. `tests/safety.test.ts` asserts this from the outside:
the role is refused when it tries to write a prescription, resolve an
escalation, or edit the audit log.

**No prescription writing yet.** The read tool exists because docs/05 lists it;
the CRM entry form and refill reminders are Phase 2 and are not built.

## Bugs found by the tests and the simulator, and fixed

- **Consent dropped the original request.** A new patient who asked to book was
  shown the consent notice; after replying YES they got a generic prompt and
  their request was gone. The pending message is now stashed on the
  conversation and replayed once consent is recorded.
- **The agent's role could not register a first-time caller.** The simulator hit
  `permission denied for table patients` on the very first message. Fixed with
  a column-scoped `grant insert (clinic_id, phone, name)` — migration 004 —
  rather than by widening the role or bypassing it.
- **A multi-doctor clinic silently picked a doctor.** With two doctors and no
  name given, the agent asked "which doctor?" but had already set the state to
  the first one, so the next message booked with whoever that was. There is now
  an explicit `awaiting_doctor` step that escalates rather than assume.

## Environment notes

The npm scripts are plain and cross-platform: `next dev`, `tsx scripts/...`.
Nothing in them assumes a shell, a platform, or a particular database host.

One constraint worth knowing when a Claude session is doing the work: **Neon is
unreachable from Claude's sandbox and from the local VM** — `*.neon.tech` is
refused by the organisation's network policy (`connect_rejected`). A session
therefore cannot run migrations or tests against Neon; it runs them against a
local Postgres of its own. To let a session use Neon directly, allowlist
`*.neon.tech` in Admin settings → Capabilities. Nothing in the code changes
either way.

Compiling the Next app through the desktop file bridge is also impractically
slow (~5s per page on local disk versus minutes across the bridge), so
`npm run dev` belongs on the developer's own machine, not in a session.

## Not built yet, on purpose

Logged rather than built, per the docs/07 ponytail rule:

- Per-doctor availability. Clinic hours are one shared 09:00–18:00, Mon–Sat
  range in `booking.ts`; the first clinic with differing doctor hours turns
  this into a table
- Escalation to a stronger model tier for genuinely ambiguous phrasing
  (docs/05). Haiku handles everything today; add the second tier when real
  conversations show where it falls short
- **Refill reminders are not scheduled.** `scheduleRefillFollowup`, the
  `refill_followup` template, and the send path all exist and are tested,
  but nothing calls it when a prescription is created. That is deliberate:
  how many days before a course ends a patient should be nudged is a
  clinical-adjacent judgement, and `docs/01` puts those with the clinic
  rather than with us. Wire it into `createPrescription` once the pilot
  clinic has chosen the lead time. Until then, the only reminders that
  actually send are appointment reminders.

Prescription entry, the reminder sender, patient screens, login rate
limiting, the purge job, and the breach runbook are now built — see
"What exists" and the session log below. Refill-followup reminders are
built but deliberately not wired, per the entry above.

---

## Session log

### 2026-09-02 — Phase 0 and Phase 1

Built from docs 00–08 with no prior code. Stack chosen with the user:
TypeScript end to end, Postgres, WhatsApp-shaped webhook with a local
simulator standing in for Meta.

- Repo initialised; docs moved to `docs/`; project relocated out of OneDrive,
  whose sync was breaking npm installs
- Schema, exclusion constraint and the agent's database role written and applied
- RBAC, consent, audit logging built and tested
- Booking engine: 15 tests including ten concurrent bookings of one slot, of
  which exactly one is allowed to win
- Database-level safety: 9 tests asserting what the agent's role cannot do
- Agent: safety screen, date parsing, tool set, conversation state machine —
  22 tests covering the docs/05 flows and the docs/08 failure modes
- Webhook signature verification and payload parsing — 4 tests
- CRM: staff login, day calendar, escalation inbox; verified rendering real
  seeded data
- Three real bugs found and fixed (above)

Still owed at the end of this session: a hosted database the environment can
actually reach, and Phase 2.

### 2026-09-03 — npm scripts made cross-platform

`npm run dev` failed on Windows: `'.' is not recognized`. The scripts had a
`./scripts/pgdev.sh &&` prefix — a bash-only helper that started a local
Postgres, which existed only because Claude's sandbox cannot reach Neon.

Fixed at the root rather than per-script: the helper is gone from the repo and
every script is now a plain cross-platform command (`next dev`,
`tsx scripts/...`). `--webpack` was dropped too — it was only needed for a
`node_modules` symlink that no longer exists, and Turbopack is the faster
default. `.env.local` now points at Neon, which the developer's machine can
reach; a session that needs a database uses its own local one via an env file
outside the repo.

Nothing in `src/` changed. 58 tests still pass.

### 2026-09-03 — real model wired in, hand-rolled parsers deleted

The agent was parsing patients' messages with regexes I wrote — `guessIntent`,
`parseDay`, `pickOffered`. That was never the design (docs/05 and docs/06 both
call for a model here); it was scaffolding that outstayed its welcome.

Replaced all three with one call to the Anthropic Messages API in
`src/lib/agent/intent.ts`: forced tool use, Haiku tier, returning intent,
doctor, day and slot index in a single round trip. Net effect is less code, not
more — `dates.ts` and `guessIntent` are gone.

What did **not** change: `screen()` still runs first and still decides
escalation with no model in the path. The model sees only the message, the
clinic's doctor names, the times just offered, and today's date — never
appointment history, never prescriptions (docs/02). A test asserts that
payload shape, and another asserts a clinical message never reaches the
classifier at all.

Failure behaviour follows docs/08: no key, an API error, or a 10-second
timeout all escalate to a human with the templated technical-failure message.
There is deliberately no regex fallback — a silent downgrade to worse parsing
is exactly the failure mode that ends with a wrongly booked appointment.

Tests: 57 offline, plus 7 live tests in `tests/intent.live.test.ts` that hit
the real API and are skipped unless `ANTHROPIC_API_KEY` is set. **The live
tests have not been run yet** — no key available at the time of writing, so
the default `ANTHROPIC_MODEL` value is unverified.

### 2026-09-05 — full code review, and the fixes

Three reviewers went over the whole tree against docs 00-08, each running the
code rather than only reading it. They found the two central safety claims did
not hold in the production configuration. Every fix below has a test that fails
without it; the suite went from 57 offline tests to 69.

**The agent could not do its job under its own database role.** `clinic_agent`
had no `SELECT` on `reminders`, so cancel, reschedule and delete-my-data each
raised `42501` partway through — after the appointment was already cancelled or
moved. With no transaction, that state committed, no audit row was written, and
the patient was told it had failed. This survived because the only agent-role
end-to-end test exercised booking; every other flow was tested as the superuser.
Migration 005 grants the select, and the agent-role tests now cover the write
flows too.

**Withdrawing consent and then re-consenting bricked the patient permanently.**
`recordConsent` set `granted` but left `deleted_at`, and `assertConsent` filters
soft-deleted rows, so the patient was walked through the entire booking flow and
failed on the last step, every time, forever. Re-consent now clears `deleted_at`.
Soft-deleted patients are also excluded from the calendar and the escalation
inbox, which were still showing their name and number.

**A lost slot race destroyed the appointment being rescheduled.** The old slot
was released first, outside any transaction, and the caller deliberately catches
`slot_taken` to re-offer — so the release committed and the appointment was gone
with nothing in its place, invisible to staff because the calendar filters to
`booked`. Booking now happens before the release, and `handleInbound` runs
inside one transaction.

**The emergency screen was English keyword matching, and missed most real
phrasings of the emergencies docs/01 names.** Verified misses included "I have
a lot of pain in my chest", "trouble breathing", "my wife is vomiting blood",
"CHEST-PAIN!!", and every Hinglish phrasing — for a pilot clinic in India.
Those messages fell through to a normal-priority "Sorry, I did not follow that",
with no mention of emergency services. The patterns are broader now, punctuation
is normalised, Hinglish terms are in, and the sixteen verified misses are a
corpus test. The `unclear` template now carries the emergency route too, because
the next miss will land there.

**A first-time patient's emergency was swallowed by the consent gate.** Anything
not understood from an unconsented patient returned the consent notice and
created no escalation, so nobody was paged. Consent governs storing and acting
on someone's data, not whether we are allowed to notice they need help; an
unclear message now escalates before the gate.

**Staff at one clinic could resolve another clinic's escalation.** Both writes
took an id from a form field with no clinic scope. Now scoped, and reading the
inbox writes an audit row.

Smaller, same session: fail closed on an unsigned webhook rather than inferring
permission from `NODE_ENV`; refuse to boot in production without
`AGENT_DATABASE_URL` rather than silently falling back to full privileges; stop
printing patient numbers and message bodies to stdout; store the scrypt cost in
the hash and raise it to the OWASP floor; reject a syntactically valid but
impossible date from the classifier (`2026-13-45` reached Postgres and threw);
offer slots spread across the day rather than the first four, which sent every
afternoon booking to a human; make the seed idempotent; refuse to substitute a
default password for the cluster-global agent role.

**A mutation test found the largest gap.** Replacing `verifyPassword` with
`return true`, deleting the escalation permission checks, and disabling the
session-secret guard left the suite entirely green. `tests/auth.test.ts` now
covers login; it fails under all three mutations.

**One test-infrastructure bug worth naming.** `npm test` was green only on
machines with one or two cores. `node --test` runs each file in its own process
by default, and all three database files truncate the same database in
`beforeEach`, so on a normal laptop they wiped each other's fixtures — 38 of 57
failing, with a misleading foreign-key error. The suite now runs with
`--test-concurrency=1`.

### 2026-09-05 — Phase 2 built, Phase 3 hardening mostly done

Prescriptions, the refill-reminder machinery (built and tested, not wired —
see below), patient screens, login throttling, the purge job, multi-clinic
isolation tests, a load test, and the breach runbook, all in one pass. Migrations 006–009. The suite went from 69 offline tests to 143: 136
passing, 7 skipped (the live Anthropic tests, still unrun — no key available).
`npx tsc --noEmit` is clean and `npm run build` succeeds.

**Prescriptions** (`src/lib/prescriptions.ts`): create, list, discontinue.
Doctor and admin only — a receptionist can read but not write, matching the
docs/08 role matrix — and every function is clinic-scoped. The CRM gained a
prescription entry form on the patient record page
(`src/app/(crm)/patients/[id]/page.tsx`).

**Reminders** (`src/lib/reminders.ts`, `src/app/api/cron/reminders/route.ts`):
appointment reminders are scheduled when an appointment is booked,
re-validated against the prescription's or appointment's current status at
send time (not just schedule time — this is the docs/08 testing-bar item
that was previously unmet), retried with backoff, and escalated to staff
once the retry budget is exhausted. `scheduleRefillFollowup` and the
`refill_followup` template exist and are tested, but nothing in `src/`
calls `scheduleRefillFollowup` yet — see "Not built yet, on purpose".
`templates.ts` holds the WhatsApp template text and renders it;
`docs/10-whatsapp-templates.md` documents the same templates for whoever
submits them to Meta.

**Patients** (`src/lib/patients.ts`, `src/app/(crm)/patients/`): search and a
record-summary view. The agent now asks for and records a patient's name on
first contact (`src/lib/agent/index.ts`, `intent.ts`) rather than leaving it
blank, which the patient list needed to be useful at all.

**Login throttling** (`src/lib/throttle.ts`, migration 009): lockout keyed on
email after repeated failed logins.

**The purge job** (`purgeDeletedPatients` in `src/lib/consent.ts`,
`src/app/api/cron/purge/route.ts`): the DPDP retention purge, guarded by the
same `CRON_SECRET` check as the reminder scheduler (`src/lib/cron-auth.ts`).

**Multi-clinic and load** (`tests/multi-clinic.test.ts`, `tests/load.test.ts`):
tenant isolation and a concurrent-booking load test, per docs/07 Phase 3.

**The breach runbook** (`docs/runbooks/breach.md`): written per docs/02.
Contact table and tabletop rehearsal are explicitly still outstanding — see
below.

#### Three real bugs, found and fixed

**Escalation was silently dropped for anyone without a conversation row.**
`escalations.conversation_id` was `not null`, so a reminder escalation for a
patient booked at the front desk — who had never messaged the clinic and so
had no `conversations` row — failed to insert at all. That is exactly the
failure the retry budget exists to prevent: a patient's medication reminder
exhausts its retries, and the escalation meant to catch that silently doesn't
happen either. Migration 007 makes the column nullable.

**`claimDue` had no locking.** Two overlapping scheduler runs (a slow run
still in flight when the next cron fires) could each claim the same reminder
row and send the same patient the same message twice. Fixed with a Postgres
advisory lock held on a reserved connection for the claim.

**The test fixture leaked failed-login rows between files.** `reset()` in
`tests/helpers.ts` did not truncate `login_attempts`, so failed logins from
one test file could carry over and lock out the shared seeded account in
another — latent, order-dependent flakiness in the suite that every other
test depends on to catch real bugs. `reset()` now truncates it.

Also worth recording outside the "three": `appointments.patient_id` was the
only patient foreign key in the original schema missing `on delete cascade`,
so the purge job would have failed outright on any patient with an
appointment. Migration 008 fixed it.

#### Deferred minors, found during review

Logged rather than fixed, per the docs/00 ponytail rule — none of these block
launch, but they should not be forgotten:

- `requireCronSecret` short-circuits on length mismatch, leaking the secret's
  length by timing. Standard idiom for this kind of check; low severity.
- The retention-boundary tests check "now" versus "31 days ago", not the exact
  30-day cutoff, so an off-by-one at the boundary would not be caught.
- `cancelReminders` dropped the `type = 'appointment'` filter the old inline
  SQL had; it now relies on UUID uniqueness across tables instead.
- `reminders.attempts` is incremented on the success path too, so the column
  reads as "attempts", not "failed attempts" — worth a rename if it starts
  driving alerting logic.
- A forged POST from an unauthorised role surfaces an unhandled `Forbidden`
  (500-shaped) instead of a friendly redirect. Nothing is written in that
  path; this is a UX gap, not a safety one.
- The prescription form's doctor dropdown lets a doctor attribute a
  prescription to any doctor in the clinic, because `currentStaff()` doesn't
  expose `doctor_id`.
- `recordFailure`'s cleanup `DELETE` has no email predicate, so it can't use
  the index — a sequential scan per failed login. Fine at clinic scale.
- Template text and `docs/10-whatsapp-templates.md` are kept in sync by prose
  instruction, not by a test.
- No adversarial cross-clinic test yet for the WhatsApp agent tool path, or
  for reminder delivery specifically (the CRM-side multi-clinic tests exist;
  these two paths don't yet).
- `tests/load.test.ts` shares its fixture across both tests via `before`/
  `after` rather than `beforeEach` — safe today because the two tests use
  non-overlapping day offsets, but worth tightening if a third test is added.

#### Still owed before launch

- `ANTHROPIC_API_KEY` is not set, so the 7 live classifier tests have never
  run and the default `ANTHROPIC_MODEL` value is unverified.
- Neither WhatsApp template has been submitted to Meta; nothing can reach a
  real patient until they're approved.
- The migrations have never been run against the production Neon database.
- The breach runbook's contact table needs filling in, and the tabletop
  rehearsal (docs/07 Phase 3) has not happened.
- The 30-day retention window in `purgeDeletedPatients` is an engineering
  guess that needs legal confirmation.
