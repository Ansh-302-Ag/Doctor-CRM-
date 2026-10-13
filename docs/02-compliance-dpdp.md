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

### Open question: classification happens before consent

The agent has to understand a patient's first message well enough to
tell a "yes" from anything else, and it does that with a model call —
which means the inbound message text reaches the LLM API before consent
is recorded, not after. This is arguably unavoidable: the consent reply
itself is what needs classifying, and the code predates this branch.

What limits the exposure today: only the message text, the clinic's
doctor names, the times already offered, and today's date are sent to
the classifier — never appointment history or prescription records
(see "What this means for the agent specifically" below), and this
holds whether or not consent has been recorded yet.

This is recorded here as an open question, not resolved: **counsel
should confirm whether pre-consent classification is acceptable under
DPDP before a real clinic is onboarded.**

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
  after. Who gets notified, in what timeframe, using what channel. See
  `docs/runbooks/breach.md` — it still needs its contact table filled
  in and one tabletop rehearsal before launch.

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

## WhatsApp platform policy and Indian law — research, 2026-10-12

Recorded after a web review of Meta's policy and Indian regulation. This is
engineering research, not legal advice; every item below still goes to
counsel before the first paying clinic.

### Meta: AI on WhatsApp is allowed, for our kind of assistant

Since 15 January 2026 Meta's WhatsApp Business Solution terms prohibit
*general-purpose* AI assistants (ChatGPT-style products whose primary
function is the AI). Business-specific automation — booking, order status,
support — stays allowed, including when an LLM powers it, provided it stays
on the business's own topic and hands off everything else. Our agent fits:
a fixed tool set, and everything off-topic escalates. Meta decides "primary
functionality" at its sole discretion, so menu mode (no model in the patient
path) is the lower-risk default.

The WhatsApp Business Messaging Policy (last updated 2026-09-23) also
requires "prompt, clear, and direct escalation paths", naming in-chat
transfer to a human agent. `escalate_to_human` and the inbox satisfy this.

### Meta: the health-information clause — a real conflict

The same policy, §3: *"Don't use WhatsApp for telemedicine or to send or
request any health related information."*

| Feature | Assessment | Decision |
|---|---|---|
| Booking, reminders, tokens, "now serving" | Logistics, not health information | Keep |
| Prescription contents sent on WhatsApp (`prescribeAndNotify`, `src/lib/doctor.ts`) | Sends health information — directly against §3 | **Change**: send a "your prescription is ready" notice with a secure OTP-gated link; never the drug or dosage |
| Reading a prescription back in chat (`get_prescription_summary`, "My prescription") | Same | **Change**: same link, not the contents |
| Asking for a reason for visit (`reason_text`) | Requests health information | Make optional, or stop asking on WhatsApp |
| Patient volunteers symptoms ("chest pain") | Not requested by us; we only escalate | Keep |

The risk is not a fine but the **clinic's number being banned**. Until the
change ships, the prescribe-and-send path must not be used with real
patients. This supersedes the "prescriptions go to the patient's WhatsApp"
decision recorded in docs/09 (2026-09-22).

### Meta: opt-in and templates

- Businesses may only message people who opted in to receive messages. The
  consent notice must say plainly that the patient agrees to appointment
  messages on WhatsApp.
- Inside the 24-hour customer-service window any reply (text, buttons,
  lists) is allowed without approval. Outside it, only approved templates.
  Every clinic-initiated message — reminders, delayed confirmations, queue
  updates, "prescription ready" — needs a Utility template, per clinic WABA.
- Utility templates inside an open window are free; outside it about
  ₹0.13 each in India (Meta pricing, July 2025 onward).

### India: Telemedicine Practice Guidelines (2020)

AI/ML platforms may not counsel patients or prescribe medicines; they may
only support a registered doctor. Already our core rule (docs/01) and
enforced at the database level (docs/08).

### India: DPDP Rules 2025 timing and gaps

The Rules were notified on 13 November 2025; most operational duties apply
18 months later (about May 2027). Gaps against them, beyond what this file
already covers:

- Reasonable security safeguards: field-level encryption and staff
  multi-factor login are not built.
- Breach notification to patients and the Data Protection Board — confirm
  the timeline in the Rules text (secondary sources say 72 hours) and put it
  in `docs/runbooks/breach.md`.
- A data-processing agreement with each clinic: the clinic is the data
  fiduciary, we process on its behalf.
- The consent notice must disclose that message text is processed by an AI
  provider outside India (Anthropic or Groq) when AI mode is on.

### Sources

- WhatsApp Business Messaging Policy — https://whatsappbusiness.com/policy/
- respond.io, "Not all chatbots are banned" — https://respond.io/blog/whatsapp-general-purpose-chatbots-ban
- Meta, WhatsApp pricing — https://developers.facebook.com/docs/whatsapp/pricing
- MediaNama, Telemedicine Practice Guidelines summary — https://www.medianama.com/2020/03/223-summary-india-telemedicine-guidelines/
- EY, DPDP Act and Rules 2025 — https://www.ey.com/content/dam/ey-unified-site/ey-com/en-in/pdf/2025/11/ey-india-dpdp-act-2023-and-rules-2025-pov.pdf
- KPMG, DPDP in healthcare — https://assets.kpmg.com/content/dam/kpmgsites/in/pdf/2025/12/the-privacy-prescription-impact-of-dpdp-act-and-rules-in-healthcare-and-life-sciences-sector.pdf.coredownload.pdf
