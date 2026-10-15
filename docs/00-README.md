# AI Receptionist for Clinic Management — Project Docs

This folder is the single source of truth for the project. Read in order
the first time; after that, jump to whatever you're working on.

| # | File | What it covers |
|---|------|-----------------|
| 00 | README.md | This index + working principles |
| 01 | problem-and-scope.md | Problem statement, product vision, hard scope boundaries |
| 02 | compliance-dpdp.md | India DPDP Act obligations, consent, data handling rules |
| 03 | architecture.md | System layers, components, data flow |
| 04 | database-schema.md | Tables, relationships, field-level notes |
| 05 | agent-tools-and-flows.md | Agent tool definitions, WhatsApp conversation trees, guardrails |
| 06 | tech-stack-and-cost.md | Concrete stack choices + cost model |
| 07 | mvp-roadmap.md | Phased build plan, what NOT to build yet |
| 08 | security-and-error-handling.md | RBAC, encryption, audit logs, failure modes, testing bar |
| 09 | implementation-log.md | What is actually built, decisions made while building, what is still owed |
| 10 | whatsapp-templates.md | The WhatsApp template text submitted to Meta |
| 11 | product-overview.md | What Doctor-CRM does, feature by feature — AI chat and menu modes, dashboard, safety |
| — | runbooks/ | `breach.md` (suspected DPDP breach), `dev-server.md` (the always-on dev deployment) |

## Why this document set exists

This is a healthcare-adjacent product. Patient data, appointment records,
and prescription records are sensitive by nature, and mistakes here are
not "just bugs" — they can mean a missed medication reminder, a wrongly
booked slot, or a real privacy breach. The bar for correctness is higher
than a typical SaaS MVP, so we're front-loading the thinking instead of
discovering these constraints mid-build.

## Working principles for this project

**1. The AI never makes clinical decisions. Ever.**
It books, reschedules, reminds, records, and routes. Anything that even
brushes against "should I take X" or "is this normal" gets escalated to
a human, no exceptions. This rule is enforced at the prompt level, the
tool level, and the database level (see 01 and 05).

**2. Ponytail discipline — build the smallest thing that works.**
No speculative abstractions, no premature multi-tenancy gymnastics, no
custom framework where a library exists, no voice channel until WhatsApp
+ CRM is proven. Every "we might need this later" gets cut from the MVP
and logged in the roadmap instead of built. See `07-mvp-roadmap.md`.

**3. Superpowers workflow discipline when we actually start coding.**
- `brainstorming` skill before any new feature — this doc set IS that
  brainstorming output for the initial architecture.
- `writing-plans` → a concrete implementation plan before touching code,
  derived from these docs.
- `test-driven-development` for every feature that touches booking logic,
  patient data, or reminders — tests written first, especially for
  anything that could double-book a slot or misfire a medication
  reminder.
- `systematic-debugging` for any bug — no guessing fixes.
- `verification-before-completion` — nothing is "done" until it's been
  run and verified, not just written.
- `requesting-code-review` / `receiving-code-review` before merging
  anything that touches patient data or the booking engine.

**4. Data minimization by default.**
If a field isn't needed for booking, reminders, or the doctor's record,
it doesn't get collected. Every new field added to the schema should be
justifiable in one sentence (see `04-database-schema.md`).

**5. Everything sensitive is logged, nothing sensitive is guessed.**
Consent state, who accessed what patient record, every message the
agent sent, every escalation — all logged. If the agent isn't sure what
the patient meant, it asks or escalates; it does not assume.

## How to use this as we build

Treat these files as living documents. When a decision changes, update
the relevant file and note the date/reason at the bottom of that file —
don't just change it silently, since future-us needs to know *why* we
moved away from an earlier decision.
