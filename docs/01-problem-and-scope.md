# Problem Statement & Scope

## Problem

Most independent clinics run front-desk operations manually: a human
receptionist answers calls/WhatsApp, checks a paper or spreadsheet
calendar, books slots, and separately tracks patient history and
medications. This is slow, error-prone (double bookings, lost records),
and doesn't scale past the receptionist's working hours.

## Product

An AI agent that handles incoming WhatsApp messages (and, later, calls)
to manage clinic front-desk logistics, backed by a CRM where the doctor
and staff manage patients, appointments, and prescription records.

## Non-negotiable scope boundary

**The AI manages logistics. The doctor makes every clinical decision.**

### The AI is allowed to:
- Book, reschedule, cancel appointments
- Check doctor availability
- Store prescription records **exactly as entered by the doctor/staff**
  (drug name, dosage, duration) — as a record, not a recommendation
- Send appointment reminders and reminders to follow up when a
  prescribed course is ending
- Take a patient's stated symptom/complaint as free text and attach it
  to the appointment request, unread by the AI for clinical meaning —
  just forwarded to staff
- Ask basic clarifying questions needed to book correctly (date, doctor,
  reason for visit as raw text, contact info)
- Escalate anything ambiguous or clinical to a human

### The AI must never:
- Suggest, confirm, or imply a diagnosis
- Answer any medication question beyond reading back what's on file
  ("Your record shows Amoxicillin 500mg, twice daily, prescribed on
  [date]") — no "can I take this with X", no "is this side effect
  normal", no dosage adjustment advice
- Decide urgency or triage a symptom as an emergency or not
- Modify a prescription record — only staff/doctor accounts can write
  to that table
- Continue a conversation once it detects a clinical question — it
  escalates immediately, every time, no attempt to "be helpful" first

### The escalation rule (memorize this, it drives the whole agent design)

> If a message could be answered two ways — one purely logistical, one
> that requires clinical judgment — the agent treats it as clinical and
> escalates. Ambiguity always resolves toward the human, never toward
> the AI attempting an answer.

This is enforced in three places, not just the prompt:
1. **Prompt/instructions** — explicit rule + few-shot examples of
   correctly escalated messages (see `05-agent-tools-and-flows.md`)
2. **Tool design** — there is no tool that lets the agent answer a
   clinical question; the only paths are "logistics tool" or
   "escalate_to_human"
3. **Database permissions** — the agent's service account has read-only
   access to prescription records and zero write access to anything
   diagnosis/treatment related (see `08-security-and-error-handling.md`)

## Human escalation triggers (non-exhaustive, expand as we learn)

- Any question about medication interaction, side effects, dosage change
- Any statement suggesting an emergency ("chest pain", "can't breathe",
  "bleeding") — escalate AND surface a clear "call emergency services"
  message to the patient, don't just queue it for later
- Angry/frustrated patient, repeated failed booking attempts
- Insurance/billing disputes
- Anything the intent classifier is not confident about
- Any request outside the defined tool set

## Out of scope for v1 (revisit later, not now)

- Voice/calls (see `07-mvp-roadmap.md` for why WhatsApp comes first)
- Multi-language support beyond what's needed for the pilot clinic(s)
- Insurance claim processing
- Lab report interpretation or delivery of results with commentary
  (raw report delivery/storage is fine, interpretation is not)
- Patient-facing health advice of any kind
