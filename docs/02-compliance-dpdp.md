# Compliance — India, DPDP Act 2023

Scope decision: **India-only for v1.** This file governs data handling;
revisit if/when expanding to a market with its own regime (e.g. US
HIPAA would require a largely separate compliance pass, not an add-on).

> This is not legal advice. Have an actual lawyer review the consent
> flow and privacy policy before onboarding a real clinic — this doc is
> the engineering-facing checklist, not a substitute for legal sign-off.

## Who is who, legally

- The **clinic/doctor** is the entity patients trust with their data.
- We (the platform) are processing that data on the clinic's behalf —
  practically, we should treat ourselves as a **data fiduciary** for
  engineering purposes even though DPDP's exact allocation of
  fiduciary/processor roles for a vendor like us should be confirmed
  with counsel. Build as if we carry real responsibility, because we do.

## Consent

- Consent must be **specific, informed, and revocable**. Before the
  agent books a first appointment, the patient must see (in WhatsApp,
  in their language) what data is collected (name, phone, health-related
  messages, appointment/prescription history) and why (booking,
  reminders, doctor's records) — not a buried link, an actual short
  message with a clear yes.
- Store consent as a **first-class record**: who consented, when, to
  what version of the notice, and via what channel. Never infer consent.
- Build a **withdraw/delete path** from day one: a patient can message
  "delete my data" or similar and it triggers a real, tracked deletion
  workflow (soft-delete + purge job), not a manual ask-the-founder
  process. This is far cheaper to build now than to retrofit later.

## Data minimization

- Collect only what booking, reminders, and the doctor's record need:
  name, phone number, appointment history, doctor-entered prescription
  records, and the raw text of what the patient said when booking.
- Do not build "nice to have" profile fields (e.g. full medical history
  intake forms) into v1 — that's a HIPAA-grade data-collection surface
  we don't need yet and it only increases breach impact.

## Breach handling

- DPDP requires notifying the Data Protection Board and affected users
  on breach, with no minimum size threshold — so "it was a small leak"
  is not a reason to skip notification.
- Practical implication: **have a breach runbook before launch**, not
  after. Who gets notified, in what timeframe, using what channel. This
  is a doc, not code, but it belongs in this repo (`docs/runbooks/`)
  once we're closer to launch.

## Technical requirements this drives

- **Encryption in transit**: TLS everywhere, no exceptions, including
  internal service-to-service calls once there's more than one service.
- **Encryption at rest**: managed Postgres (Supabase/Neon) with at-rest
  encryption enabled; consider field-level encryption for prescription
  text and raw patient messages specifically (higher sensitivity than,
  say, appointment timestamps).
- **Access control**: role-based from day one — receptionty/staff role
  vs doctor role vs admin role vs the AI agent's own service account.
  See `08-security-and-error-handling.md` for the actual role matrix.
- **Audit logging**: every read/write to a patient or prescription
  record logs who (or "AI agent") did what, when. This is also just
  good practice for debugging a system nobody's allowed to get wrong.
- **Data localization**: DPDP doesn't force in-India hosting for most
  countries, but confirm this hasn't changed before going live, and
  prefer India-region hosting where available (Supabase/Neon both offer
  regions that make this straightforward) — it also gets you lower
  latency for an India-based clinic.
- **Vendor exposure to raw data**: the LLM API call should see intent +
  necessary booking context, not the patient's full history unless the
  task genuinely requires it. Minimize what any third-party API sees at
  all, since every vendor in the chain expands the breach surface.

## What this means for the agent specifically

The agent should be designed so that if the LLM API itself were ever
compromised or logged upstream, the blast radius is small: it sees
booking-relevant text, not a full medical dossier, on every single
call. See `05-agent-tools-and-flows.md` for how tool scoping enforces
this.
