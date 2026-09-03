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
| Phase 2 — prescriptions + refill reminders | Not started (read path exists; entry UI and reminders do not) |
| Phase 3 — second clinic + hardening | Not started |
| Phase 4 — voice | Not started, and deliberately so |

**58 tests, all passing**, run against a real Postgres — including the
concurrency, permission and escalation cases docs/08 names as the bar.

---

## What exists

```
db/                    numbered SQL migrations, applied in order
  001_init.sql         the docs/04 schema + the double-booking exclusion constraint
  002_agent_role.sql   the clinic_agent Postgres role and its grants (docs/08)
  003_clinic_phone.sql the clinic's own number, quoted in every escalation reply
  004_agent_patient_intake.sql  lets the agent register a first-time caller

src/lib/
  db.ts                two pools: the app role, and the agent's restricted role
  password.ts          scrypt via node:crypto — no auth dependency
  rbac.ts              the docs/08 role matrix, written once
  audit.ts             append-only "who did what" writes
  consent.ts           versioned notice, consent gate, DPDP withdrawal path
  booking.ts           availability, book, reschedule, cancel, ownership checks
  escalations.ts       the staff side of the escalation queue
  auth.ts / session.ts staff login and the signed session cookie
  channel.ts           outbound WhatsApp, or console when unconfigured
  webhook.ts           signature verification and payload parsing
  agent/
    screen.ts          the deterministic safety screen + templated replies
    intent.ts          Anthropic Messages API — intent + doctor + day + slot
    tools.ts           the entire tool set (docs/05) and nothing else
    index.ts           the conversation state machine

src/app/
  login/               staff sign-in
  (crm)/               calendar + escalation inbox, behind the session check
  api/webhook/whatsapp route handler: verify, parse, handle, reply, notify

scripts/
  migrate.ts           applies pending db/*.sql, one transaction each
  seed.ts              a clinic, two doctors, three staff logins
  sim.ts               terminal WhatsApp simulator against the real agent

tests/                 58 tests: booking, safety, agent, screen, dates, webhook
```

## Decisions made while building

**One Next.js app, not three services.** Docs/03 describes agent, backend and
CRM as separate layers. They are still separate *modules* — `src/lib/agent`
never touches the database except through `src/lib/booking` — but they deploy
as one app. At one clinic, three deploys buy nothing and cost operational
attention. Splitting later is moving files, not rewriting logic.

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

- Prescription entry UI and refill reminders (Phase 2)
- The reminder sender itself — the `reminders` table exists and cancellation
  is wired, but nothing schedules or sends yet
- Patient-record and patient-search screens in the CRM
- Per-doctor availability. Clinic hours are one shared 09:00–18:00, Mon–Sat
  range in `booking.ts`; the first clinic with differing doctor hours turns
  this into a table
- Escalation to a stronger model tier for genuinely ambiguous phrasing
  (docs/05). Haiku handles everything today; add the second tier when real
  conversations show where it falls short
- The breach runbook (docs/02) — a document, still owed before launch

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
