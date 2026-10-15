# MVP Roadmap

Ponytail rule applied throughout: build the smallest thing that proves
the loop works, cut everything speculative, log deferred items instead
of building them "just in case."

## Phase 0 — Foundations (before any patient touches this)
- Database schema (doc 04) migrated, with the double-booking exclusion
  constraint in place and tested
- RBAC roles wired up in the backend (doc 08) — this is not something
  to bolt on later
- Consent flow built and tested (doc 02) — no booking happens without
  a recorded consent
- Audit logging wired into every read/write of patient/prescription
  data from day one, not retrofitted

## Phase 1 — WhatsApp booking loop, one clinic
- WhatsApp webhook receiving + sending messages
- Agent with exactly 4 tools: check_availability, book_appointment,
  reschedule_appointment, cancel_appointment
- escalate_to_human wired to a real notification (even if it's just a
  WhatsApp message to a staff number for now)
- CRM: read-only calendar view + escalation inbox for staff — doesn't
  need to be pretty, needs to be accurate
- Goal: a real receptionist could stop manually booking for this one
  clinic and trust the system

## Phase 2 — Prescription records + refill reminders — **Done**
- Doctor/staff can enter prescription records in the CRM
- get_prescription_summary tool (read-only) added to the agent
- Refill-followup reminders: machinery built and tested, deliberately not wired — see docs/09
- This is where the "never let the agent write to prescriptions" rule
  gets its first real test — write a test that asserts the agent's DB
  role literally cannot INSERT into `prescriptions`

See `docs/09-implementation-log.md` for the session this was built in.

## Phase 3 — Second clinic + hardening — **Partly done**
- Multi-clinic tested (schema already supports it — this is about
  operational tooling, not a rebuild) — **done**, `tests/multi-clinic.test.ts`
- Load-test the availability/booking path for concurrent requests
  (this is where the exclusion constraint earns its keep) — **done**,
  `tests/load.test.ts`
- Full breach runbook finalized, tabletop-tested once — runbook written
  (`docs/runbooks/breach.md`); its contact table still needs filling in and
  the tabletop rehearsal still needs to happen before launch

## Front desk and patient record — **Done** (2026-10-15)
- Staff book, reschedule, cancel, register walk-ins and mark arrived /
  completed / no-show from the CRM (the Phase 1 calendar is no longer read-only)
- Patient timeline, notes, follow-up tasks, Ctrl+K quick find, merge
  duplicates, CSV export — ideas from twentyhq/twenty, in clinic form
- Spec and plan in `docs/superpowers/`; status in `WORK_TO_DO.md`

## Phase 4 (not before the above is solid) — Voice
- Add voice as a second input channel into the same agent layer
- Expect 3-5x cost per interaction vs WhatsApp — validate demand first
- Telephony provider: Twilio or Exotel (Exotel often cheaper for
  Indian numbers)

## Explicitly deferred, log-don't-build

- Multi-language support beyond the pilot clinic's needs
- Insurance/billing
- Lab report interpretation
- Analytics dashboards beyond basic appointment counts
- Anything "an investor might ask about" that doesn't serve the
  booking/CRM loop directly — resist scope creep here specifically,
  since this is the phase where it's tempting to over-build for a demo

## Definition of "MVP done"

Phase 1 + Phase 2, running for one real clinic, for at least 2-4 weeks,
with zero double-bookings, zero agent responses to clinical questions,
and a receptionist who says it's actually saving them time. Anything
short of that isn't ready to show a second clinic.
