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

**204 tests: 197 passing, 7 skipped** against a real Postgres. The 7 skipped
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
  patients.ts          patient search, record summary, name capture, doctor scoping
  doctor.ts            the doctor's queue, and prescribe-and-send-to-the-patient
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
  (crm)/queue/         the doctor's own day: his appointments, and who is next
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
  path; this is a UX gap, not a safety one. (The one case that a real user can
  reach by hand — a doctor opening `/escalations` — now renders a sentence
  instead; see 2026-09-22.)
- ~~The prescription form's doctor dropdown lets a doctor attribute a
  prescription to any doctor in the clinic, because `currentStaff()` doesn't
  expose `doctor_id`.~~ Fixed 2026-09-22 — see the session at the end of this
  file. `currentStaff()` carries `doctorId`, and a doctor no longer sees the
  dropdown at all.
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

---

## Session — 2026-09-21: live WhatsApp testing, and a fast test loop

### An unofficial WhatsApp gateway (`55ca998`)

Until now nothing could reach a real phone: the Meta Cloud API needs an
approved business account, approved templates and a public HTTPS webhook, none
of which exist yet. Baileys — an unofficial library that links a normal
WhatsApp account as a "linked device", the same mechanism WhatsApp Web uses —
closes that gap for testing.

It is a separate Node process in `whatsapp-gateway/`, with its own
`package.json` and its own `node_modules`; nothing was added to the app's
dependencies. It holds the socket, prints a QR code, reconnects on its own, and
does no business logic at all — so re-scanning after a disconnect never touches
the app.

**The design decision worth recording: the gateway speaks WhatsApp Cloud API,
not a contract of its own.** The reference project this idea came from
(`../travel-agent`) invented a bespoke JSON shape between its sidecar and its
backend, which permanently couples the two. Ours does the opposite — the
gateway emits Meta's webhook envelope, HMAC-signed with `WHATSAPP_APP_SECRET`,
and accepts Meta's send body on `POST /:phoneNumberId/messages`. So
`src/lib/webhook.ts`, the inbound route, the agent and every existing test are
untouched. Pointing at the gateway is one env var, `WHATSAPP_API_BASE`, and
going live on real Meta is deleting it. Testing and production share one code
path rather than diverging.

The gateway signs its POSTs deliberately, so `ALLOW_UNSIGNED_WEBHOOKS` never
has to be turned on. That flag would let anyone POST claiming any patient's
number and book, cancel or trigger delete-my-data on a stranger's record.

Two things did have to change:

- `channel.ts` gained an `apiBase()` helper and a four-line branch in
  `sendTemplate`. Baileys has no template concept, so when `WHATSAPP_API_BASE`
  is set the already-rendered `renderTemplate(...).preview` text is sent
  instead. Nothing else in that file moved.
- `tsconfig.json`'s `exclude` widened to `**/node_modules`, or the gateway's
  Baileys type definitions would be pulled into the app's program.

**`@lid` handling.** Newer WhatsApp sometimes reports a "linked ID"
(`…@lid`) instead of a phone number. The reference gateway passes those
through verbatim; ours must not. The app does `phone = "+" + from` and keys
patients, consent, audit and dedupe on that string, so a lid arriving as `from`
would create a second patient record for someone who already exists — split
history, split consent, and a reminder later sent to a number that does not
exist. `senderPhone()` prefers the real number Baileys carries alongside the
lid (`key.senderPn`, or `key.remoteJidAlt` in Baileys 7.x) and otherwise drops
the message with a loud error. One unanswered patient visible in the logs beats
silently corrupting identity in a clinical record.

**The test is the contract.** `tests/gateway-contract.test.ts` runs realistic
Baileys message objects through the gateway's envelope builder and signer, then
asserts the app's own `verifySignature` and `parseInbound` accept the result.
It covers text, quoted replies, disappearing messages, non-text landing in
`unsupported`, group/`fromMe`/reaction messages being ignored, device-suffixed
JIDs, both `@lid` outcomes, and — the case the HMAC exists for — a valid
signature with another patient's number swapped into the body being rejected.

Known gap, deliberately not fixed: **a failed webhook POST is not retried.**
Meta redelivers; Baileys will not. The app already dedupes on
`providerMessageId`, so retry-with-backoff is safe to add whenever it bites.

### Tests run against a local Postgres now (`7447bae`)

The suite required `TEST_DATABASE_URL` pointing at a Neon database. Measured
from the development machine, Neon us-east-2 is **279 ms per round trip** and
~2.9 s cold, which made a full run take minutes and made every edit expensive
to verify — the single biggest tax on the work in this repo.

`scripts/test.mts` now starts a throwaway Postgres (the `embedded-postgres`
dev dependency, data in the gitignored the system temp directory), migrates it, runs the suite
against it and shuts it down. `TEST_DATABASE_URL` still wins when set, so
`npm run test:neon` keeps the old path — which is still the run to trust before
a release, because it is the only one that exercises the real database.
`npm test -- tests/booking.test.ts` runs a single file.

Two failure modes cost real time and are worth not rediscovering:

- `embedded-postgres` binds a unix socket only unless told
  `-c listen_addresses=127.0.0.1`. The tests connect over TCP, so without it
  every one of them fails with `ECONNREFUSED` while migrations, which ran
  moments earlier, succeed.
- `return run(...)` inside `try/finally` in an async function runs the
  `finally` when the promise is *created*, not when it settles — so Postgres
  was being stopped the instant the test child was spawned. It must be
  `const code = await run(...)`.

**Verified only in part:** `tests/booking.test.ts` passes 16/16 against the
local database in 37 s. The full suite has not yet been run end to end on this
path — each shell call in the development environment caps at 120 s and the
whole suite exceeds it, so it needs to be run in chunks or from a real
terminal. Treat the local path as working-but-unproven until that happens.

Worth noting for whoever picks this up: 37 s for 16 tests is still slower than
it should be for a local database. The likely cost is `scrypt` at N=2^17 in
`seed()`, twice per fixture. Lowering the cost factor for tests only would
probably halve the suite again.

#### Still owed

- The CRM redesign. `main` has the pre-redesign UI. Branch
  `ui-redesign-wip` holds a draft, plus a stash (`git stash list`) with further
  edits and a `.shots/` directory of verification screenshots that are
  gitignored. **None of it has been reviewed** — treat it as material, not as
  finished work.
- The full test suite has never been run green end to end on the local path.
- Everything in the previous session's "Still owed before launch" list.

### Fix: a greeting no longer escalates (2026-09-22)

The first live WhatsApp test found it immediately. "hello" from a new patient
came back as *"Sorry, I did not follow that — I have passed it to the clinic
team"*. The database reason was `intent unclear, before consent`.

The pre-consent branch in `route()` escalated any `unclear` intent, on the
reasoning recorded in its comment: "an un-understood message from someone we
have never met still reaches a human." That is wrong here for two reasons.
The deterministic screen runs *before* the consent gate, so anything clinical
or urgent already escalates regardless of consent — this branch was never the
safety net it claimed to be. And "hi"/"hello"/"namaste" is how nearly every
WhatsApp conversation in India opens, so in practice it escalated **every
patient's very first message** and answered the most common path in the
product with an apology.

Now an unreadable message before consent gets an introduction — who is
writing, what the assistant can do, that anything medical goes to a person,
then the consent notice. `introduction()` in `src/lib/consent.ts`; the bare
`CONSENT_NOTICE` opening "Before we book…" answered a question the patient had
not asked.

To avoid trading an escalation for an infinite loop, `GreetingState` counts
consecutive unreadable pre-consent messages; the third one escalates with
reason `repeatedly unclear, before consent`. Two tests cover both halves.

Also moved the test database from a repo-local `.pgdata/` to the system temp
directory. Disposable test data does not belong in the working tree, and a run
killed mid-flight left a `postmaster.pid` behind that blocked the next start.


## Session — 2026-09-22: the CRM split by role, and the doctor's own screens

The user's words: *"if it is send to human escalation it should go to
receptionist(portal) and not to doctor portal. Doctor should only be able to
his bookings - who is next in line - to select the current patient and
prescribe his medicine -- the dosage and that all will go to his whatsapp in a
structured message"*.

### Escalations left the doctor's screen

`rbac.ts` handed `doctor` the whole staff permission list, so the inbox was in
front of everyone. `escalations:read` and `escalations:resolve` are now
receptionist and admin only; the doctor keeps `escalations:create`, because the
agent-facing rule that anything clinical reaches a human is unchanged.
`listEscalations` takes the role and calls `requirePermission` itself, so the
refusal is in the library rather than in the page that happens to call it, and
the page renders "Not available for your role" instead of an unhandled 500.
docs/08's matrix was rewritten to match.

### `currentStaff()` carries `doctor_id`

One extra column on a query that already joined `staff_users`. It closes the
gap logged in "Deferred minors": the prescription form had a doctor dropdown
because nothing knew which doctor was signed in, so a doctor could attribute
his prescription to a colleague. A doctor now sees no dropdown and the
attribution is his own; an admin, who has no doctor row, still picks one.

### The doctor's day (`/queue`)

His own booked appointments for the day, in time order, with the next one —
the first still-booked appointment that has not started — ringed and labelled.
Each row opens that patient's record. Sign-in sends a doctor here rather than
to the clinic calendar, which stays available, read-only, so he can see how
busy the place is without being able to act on anyone else's patient.

The scoping is in the query, not the markup: `patientScope()` restricts a
doctor's patient list and every record he can open to people with an
appointment with him at this clinic. An id in a URL still proves nothing.

### Prescribing sends the record to the patient's WhatsApp

`prescribeAndNotify` writes the row first and messages afterwards, and no send
failure is allowed to propagate: the record is the point, and losing it to a
502 from Meta would be the worst outcome available. The message is assembled
by reading the stored row back, so what the patient is told is by construction
what was stored — drug, dosage, duration, notes, exactly as typed, plus who
prescribed it, when, and the clinic's number for questions. It states; it never
advises.

**The 24-hour window.** WhatsApp permits free-form text only within 24 hours
of the patient's own last message, and docs/01 forbids clinical content in a
template, so a prescription can only go out free-form, inside the window.
`deliver()` works that out from the `messages` table (the patient's latest
inbound, via their conversations). Inside it, the record is sent. Outside it,
the prescription is still recorded and the patient gets `record_updated` — a
new template that names no drug, no dose and no instruction, only that there
is an entry to collect. Their reply reopens the window, and the existing
`check_prescription_record` path then reads the record back verbatim. That is
the whole recovery: no new table, no new job, no drug name in a template.
Either way the doctor is told on screen exactly what reached the patient, and
"not delivered" is never silent. The channel's `delivered: false` (an
unconfigured deployment) counts as not delivered, too.

### Also

- Appointment times on the patient list and patient record were formatted in
  the server's timezone rather than the clinic's — visible as soon as a doctor
  compared his queue with a record. Both now use `staff.timezone`.
- 17 new tests in `tests/doctor.test.ts`: the RBAC split, queue scoping and the
  "next" marker, cross-doctor and cross-clinic patient access, attribution,
  both sides of the 24-hour window, and that a failed send neither rolls back
  nor hides the record.

### Not done, on purpose

- No per-doctor appointment writing rules: a doctor can still reschedule
  anything his clinic can, as before. Nothing asked for that to change.
- The nudge is sent once. If it fails, the audit trail says so and the doctor
  is told; it is not retried through `reminders`, because that table's types
  are appointment/refill and a third one is a migration for a case the pilot
  has not hit yet.

---

## Session — 2026-09-22/23: live WhatsApp testing, and what it found

The gateway went live against a real phone. Everything below was found by
using it, not by reading it.

### The agent was losing the conversation (`69507ef`)

A real patient conversation went wrong in six places. Three root causes:

**The classifier was never told what the agent was waiting for.** `ClassifyInput`
carried the doctor list, the offered times and today's date, but not the step.
So a bare "Dr. Rao", sent immediately after "Which doctor would you like to
see?", classified as `unclear`. It now carries `step`, and the prompt says what
a valid answer to each question looks like.

**An `unclear` message escalated instead of re-asking, and escalating wiped the
booking state.** The patient lost everything and started over, twice, in one
conversation. Now a single `reask()` re-asks whatever question is outstanding,
counts consecutive misses, and only escalates on the third; `escalate()` no
longer clears state at all. `templates.unclear` — which carries "call 112" — is
no longer reachable for an ordinary unreadable message, which is why "ok thank
you" used to produce emergency text.

**A collected day was silently dropped.** "Sunday" was taken, then the name
question ran, and the day never came back. `BookingState` carries `day` now,
and the name and consent detours no longer reset the rest of the flow.

Also: offers are numbered (`1.`/`2.`/…) and the prompt says `slot_index` is a
zero-based index into that list — "3rd one" was booking the **1st** slot. A
phrase naming no day ("I am free") returns `day: null`. An out-of-hours request
is answered with the clinic's real hours, built from `OPEN_HOUR`/`CLOSE_HOUR`
so it cannot drift. And `requireTimezone()` now throws instead of letting
`Intl` fall back to the server's zone — a missing timezone silently shifted
every time by 5h30m for an IST clinic.

### The test suite was 100 seconds of password hashing (`f8d44fb`)

`scrypt` at N=2^17 takes ~285 ms by design, and the fixtures hash twice per
test across ~180 tests. That, not the database, is why the suite had to be
chunked across shell calls. `SCRYPT_COST` now drives it, defaulting to the
OWASP floor when unset; the runner sets it low, a weak value is refused
outright under `NODE_ENV=production`, and `tests/password.test.ts` covers the
real cost, the floor, and a hash carrying its own parameters so changing the
setting locks nobody out.

**The whole suite now runs in ~32 seconds in one command.**

### The doctor has his own side now (`291e92d`)

Escalations were visible to every role because `doctor` inherited the whole
`STAFF` list. They move to an `INBOX` list held by receptionist and admin only.
`currentStaff()` returns `doctor_id`, which closes the bug recorded above — the
prescription form no longer asks which doctor is prescribing, so a doctor can
no longer attribute his own prescription to a colleague.

`src/lib/doctor.ts` adds his queue for the day with who is next, scoped in the
query to his own patients, and prescribing that reaches the patient on
WhatsApp. The 24-hour rule shapes that: free-form is only allowed within 24
hours of the patient's own last message, and docs/01 forbids a template
carrying clinical content, so outside the window a prescription cannot be sent
at all. Inside it, the message is read back out of the stored record rather
than the form, so what the patient is told is by construction what was saved.
Outside it, the patient gets a content-free note that there is something to
collect; their reply reopens the window. Either way the row is committed before
anything is sent and no send failure propagates.

### The database moved off Neon (`61dd1e6`, `e2b2353`)

Measured from the development machine: Neon us-east-2 is **279 ms** per round
trip. One inbound WhatsApp message costs about a dozen sequential queries, so
the database's distance was three to four seconds of every reply. Measured
inbound-to-outbound in the live log: 5–13 seconds, median ~7.

**Neon has no India region** — its regions are N. Virginia, Ohio, Oregon,
Frankfurt, London, Singapore, Sydney and São Paulo, and a project cannot be
moved between them. Singapore would be ~50–70 ms; a Postgres beside the app is
~1 ms. So `npm run db` starts one locally (data in the gitignored `.pgdata/`),
and `.env.local` points at it with the Neon URLs commented out rather than
deleted.

Three things cost real time getting that running, all now named by the script
itself when it fails: a Postgres data directory is **not portable between
operating systems**, so one created on Linux stops Windows dead; Postgres
**refuses to run from an administrator terminal** on Windows by design, and
`initdb` allows it, so the cluster gets created and only the start fails; and
`embedded-postgres` reports a failed start as an undefined rejection, so the
script now buffers Postgres's own output and prints it on failure.

### Gateway lessons from real use

- **Never run two gateway instances.** Two Baileys processes sharing one auth
  directory make WhatsApp log the session out, and before that they race the
  same Signal ratchet — which shows up as `Bad MAC`, `Closing open session in
  favor of incoming prekey bundle`, and "Waiting for this message" bubbles on
  the patient's phone. Recovery is: stop everything, remove the linked device
  on the phone, delete `whatsapp-gateway/auth`, re-scan. **The gateway should
  refuse to start when another instance holds the auth directory — not done.**
- **`@lid` messages are still dropped.** `senderPhone()` prefers the real
  number Baileys carries alongside the linked id and drops the message when
  there is none, because a lid used as identity would create a second patient
  record for someone who already exists. That was the right call, but WhatsApp
  is moving to `@lid` by default, and a dropped message means a patient gets
  no reply at all. The fix is to resolve the lid on the socket rather than only
  reading it off the message. **Not done.**

### Still owed

- **The CRM redesign.** Branch `ui-redesign` (`7cbe77e`) holds the clinical
  redesign on top of current `main` — design tokens in `globals.css`, a left
  nav, per-route loading skeletons, the doctor's queue screen. It typechecks
  and the whole suite passes with it, but **no screen has been looked at in a
  browser**, so it is not merged.
- The two gateway fixes above.
- Cutting the round trips in `handleInbound` — `context()` alone does five
  sequential queries to find a patient and a conversation. Worth much less now
  the database is local, but still the right shape.
- `main` is 15 commits ahead of GitHub.

---

## Session — 2026-09-25: the database moves to Neon Singapore

The Singapore database mentioned above had never actually been created — the
only Neon project was the original `aws-us-east-2` one. Now it exists:
project `super-truth-39272047` ("Doctor CRM Singapore"), region
`aws-ap-southeast-1`, Postgres 18 (same major as the local cluster).

- All ten migrations applied, seeded (`Sunrise Clinic`, new `CLINIC_ID`).
- `clinic_agent` has a fresh random password; the local one only ever guarded
  a database on 127.0.0.1.
- Verified from outside: the agent role connects and is refused (`42501`) on
  inserting a prescription and on deleting from `audit_log`.
- Measured **~90 ms** per round trip over the pooled endpoint, against 279 ms
  for us-east-2 — roughly a second per WhatsApp reply instead of three to four.
  Local Postgres is still ~1 ms; `.env.local` keeps those lines commented as
  `LOCAL (was):` for switching back, and the pre-change file is in
  `.env.local.bak-local`.

The us-east-2 project is untouched. Delete it once nothing points at it.

---

## Session — 2026-09-30: Baileys removed, the app is on Meta's Cloud API

A Meta WhatsApp Business account exists now, so the unofficial gateway is gone:
`whatsapp-gateway/`, `tests/gateway-contract.test.ts`, the `gateway` npm
script, and the `WHATSAPP_API_BASE` override in `src/lib/channel.ts` —
including the branch that sent templates as plain text. `sendTemplate` now
always sends a real Meta template, so reminders fail until Meta approves them
(docs/10). The Graph API moves from v21.0 (unavailable 2027-01-21) to v26.0.
The README's "real phone" section now describes the Meta webhook setup.

`.env.local` has blank `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` /
`WHATSAPP_APP_SECRET` and a generated `WHATSAPP_VERIFY_TOKEN`. Until the blanks
are filled, sends are simulated and every webhook POST is rejected.

### A timezone bug the Linux VM had been hiding

On this Windows machine (IST), 11 tests failed: every slot `checkAvailability`
offered was 5h30m early, so no booking could land. postgres.js serialises a
parameter Postgres types as `timestamp` with `new Date(str).toISOString()`,
which reads a zone-less string in the *host's* zone. Correct on a UTC server,
wrong on any developer laptop in India — including `npm run dev` driving live
WhatsApp. Fixed with a `::text` cast in `booking.ts`, so Postgres alone does the
conversion. The new test in `tests/booking.test.ts` sets `TZ` to New York, fails
without the fix and passes with it.

### Tests now run on Neon Singapore `neondb_test`

Both shells in this environment are elevated, and Postgres refuses to start as
an administrator, so `npm test` cannot start its throwaway cluster here. The
Singapore project has a `neondb_test` database (its URL is commented in
`.env.local`), which runs the whole suite in about 7 minutes.

---

## 2026-10-12 — compliance research: one feature has to change

A web review of Meta's WhatsApp Business Messaging Policy and Indian
regulation is recorded in `docs/02-compliance-dpdp.md` ("WhatsApp platform
policy and Indian law"). Outcome:

- **The AI assistant is allowed.** Meta's 2026 ban covers general-purpose AI
  chatbots, not a booking assistant scoped to one business with a human
  handoff.
- **Sending prescription contents on WhatsApp conflicts with Meta's policy**
  ("don't … send or request any health related information"). This reverses
  the 2026-09-22 decision to send the record to the patient. Planned change:
  a "your prescription is ready" Utility template plus a secure OTP-gated
  link; reading back in chat goes the same way; `reason_text` becomes
  optional. Not built — it touches prescription handling, so it gets a plan
  and tests first. **Until then, do not use prescribe-and-send with real
  patients.**
- **Templates are required** for every clinic-initiated message outside the
  24-hour window, approved per clinic WhatsApp account.
- **New DPDP gaps logged:** field-level encryption, staff MFA, breach
  timeline in the runbook, per-clinic processing agreements, and disclosure
  of the AI provider in the consent notice.

Also decided (user, 2026-10-12): Doctor-CRM is built as a real product, not
to the college semester plan. College gets documents and a demo on request.

---

## 2026-10-13 — pre-live dry run (no Meta credentials yet)

Two tracks: a local dry run (dev server on :3100, real Singapore database,
HMAC-signed Meta-shaped payloads with a throwaway app secret, sends simulated),
and a 46-agent check of the WhatsApp code against Meta's v26 docs, each finding
put to two skeptics. Test patient and its audit rows deleted afterwards.

**Found and fixed on the spot:** every `/api/*` route returned 404 in
`next dev` — a stale `.next` cache from 23 Sept. Deleting `.next` fixed it.
Meta's verification would have failed on its first request. If the webhook
404s again, delete `.next` first.

**Verified working:** the GET handshake echoes the challenge; bad signatures get
401; status receipts are ignored with 200; consent → doctor → day → slot →
booked; IST slot times correct; "when is my appointment"; duplicate delivery
of the same wamid is a no-op; clinical and emergency messages (including
Hinglish) escalate with the right priority, in ~1 s with no model call; AI
steps take 1.7–4 s each through Groq; `npx cloudflared` runs (2026.10.0).

**Bugs found — not yet fixed** (none blocks a first live test; all should be
fixed before a real patient):

1. Staff alerts are free-form text, so Meta drops them once the staff phone
   has not messaged the number for 24 hours — and the send still returns 200,
   so nothing is logged. Needs a `staff_alert` template or SMS.
2. `failed` delivery statuses are discarded, so any send that Meta accepts and
   then fails (131047 outside the window, 131026 undeliverable) counts as
   delivered — reminders, prescriptions and staff pages alike.
3. If sending the reply fails after the transaction committed, the patient is
   told "technical issue" although the booking went through, and an
   escalation's staff page loses its body and priority.
4. A photo or document caption ("severe chest pain…") skips `screen()`: the
   patient gets "I can only read text", with no emergency template and no
   emergency escalation.
5. A 👍 reaction or an edited message gets "I can only read text" and pages
   staff (seen in the dry run: 4 non-text messages → 4 staff pages). Unsupported
   messages are also never stored, never escalated, and not deduplicated.
6. A message with no `from` (WhatsApp username users, first contact) fails the
   zod schema for the whole payload, which is then dropped with a 200 — no
   reply, no page, no row.
7. While asking for consent or a name, a second message overwrites the stashed
   request (`index.ts:278`, `:305`): "book Dr. Rao tomorrow" then "1" then the
   name → the agent asks "which doctor?" again, with `reason: "1"`.

Minor: redelivered webhooks after an outage are processed as fresh (Meta
retries up to 7 days); invalid JSON returns 500; the staff page can exceed
4096 characters; the 24-hour window is measured from insert time; the booking
confirmation does not name the doctor; the introduction still promises to
"read back what the doctor has already prescribed" (docs/02 says change it).

Refuted by the skeptics: template language `en` is a valid Meta code; webhook
latency is a hardening item, not a go-live failure.

---

## 2026-10-13 — fixes from the dry run and the first live test (branch `live-whatsapp-fixes`)

Plan: `docs/superpowers/plans/2026-10-13-live-whatsapp-fixes.md`, four tasks —
webhook parsing, the `staff_alert` template with a text fallback, per-message
inbound processing, and the conversation fixes. The ten defects, all fixed on
the branch and covered by tests:

1. **Staff pages dropped outside the 24-hour window** — paging sends the
   `staff_alert` template first and falls back to free-form text; if both fail
   it is logged with `console.error`, never thrown into the request.
2. **`failed` delivery statuses discarded** — now logged with the recipient
   masked and Meta's error code.
3. **A failed send after commit misled the patient and lost the page** — the
   patient is no longer told "technical issue" for a booking that went through,
   the page keeps its priority, and an undeliverable reply pages staff.
4. **A media caption skipped the safety screen** — an image or document caption
   is handled as text, so "severe chest pain" gets the emergency template and
   an emergency escalation.
5. **Reactions and edits paged staff** — reactions and system messages are
   ignored; an edit or any other unreadable message is stored, de-duplicated and
   answered honestly, with no page.
6. **A message with no `from` dropped the whole payload** — each message is
   validated on its own; an unidentifiable one is counted, logged and paged once
   without costing its neighbours.
7. **A second message overwrote the stashed request** — the first request is
   kept through the consent and name detours.
8. **The confirmation promised a reminder that was never scheduled** — an
   appointment inside the 24-hour lead time gets no reminder, and the
   confirmation now says so by omission.
9. **"OK" was not accepted as consent** — a whole-message "yes", "ok", "okay",
   "k", "sure", "agree", "haan", "ji", "हाँ", "👍" and the like count without
   asking the model; "ok but not today" does not.
10. **The confirmation did not name the doctor** — "You are booked with Dr. Rao
    for …".

Also fixed on the way: the introduction no longer offers to read back
prescriptions (docs/02); invalid JSON on the webhook returns 400, not 500; and
the staff page carries no patient text, so it cannot reach Meta's 4096-character
limit. `CONSENT_NOTICE` is unchanged, so `NOTICE_VERSION` is not bumped.

**Still open:** `staff_alert` has not been submitted to Meta (docs/10), so until
it is approved every page takes the free-form fallback, which only reaches a
phone that messaged the number in the last 24 hours. Submit it before a real
patient.

**Deferred (minor):** redeliveries after an outage are processed as fresh
(Meta retries for up to 7 days); the 24-hour window is measured from insert
time, not Meta's timestamp; a transient failure before commit forfeits Meta's
redelivery; SMS (Fast2SMS) as a second staff-alert channel. Also worth a look:
the emergency reply now waits on the staff page, and Graph API calls have no
timeout — a slow Graph delays emergency advice.
