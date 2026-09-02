# Architecture

## Layers

```
Patient (WhatsApp)
        │
        ▼
Conversational Layer (WhatsApp Cloud API webhook)
        │
        ▼
Agent/Orchestration Layer (intent → tool call → response)
        │
        ▼
Backend API (booking logic, records, reminders, escalation)
        │
        ▼
Database (Postgres — patients, appointments, prescriptions, consent,
          audit logs)
        │
        ▼
CRM Frontend (doctor/staff dashboard — Next.js)
```

Voice is deliberately absent from v1. When it's added later, it plugs
into the same Agent/Orchestration layer as a second input channel next
to WhatsApp — the backend, database, and CRM don't change.

## Component responsibilities

**WhatsApp Cloud API (webhook receiver)**
- Receives inbound messages, verifies webhook signature
- Sends outbound messages (confirmations, reminders)
- No business logic here — pure transport

**Agent/Orchestration layer**
- Classifies intent (book / reschedule / cancel / refill-reminder-ack /
  general query / clinical-question / unclear)
- On a clinical-question or unclear classification → escalate, full
  stop, does not attempt a tool call
- On a logistics intent → calls exactly one of a small, fixed tool set
  (see `05-agent-tools-and-flows.md`)
- Cheap model (e.g. Haiku-tier) handles intent classification and
  slot-filling for the common cases; escalate to a stronger model only
  if the cheap model reports low confidence — never for clinical
  reasoning, only for parsing ambiguous logistics phrasing
- Stateless per message where possible; conversation state (what step
  of booking we're on) lives in the database, not in agent memory —
  this makes the agent layer trivially horizontally scalable and easy
  to test in isolation

**Backend API**
- Owns all business logic: slot availability, double-booking
  prevention, reminder scheduling, escalation routing, audit logging
- The agent talks to the backend only through the defined tool
  endpoints — it never queries the database directly
- This is also where role-based access control is enforced for the CRM

**Database**
- Single Postgres instance for v1 (managed — Supabase or Neon). No
  need for multiple databases or services at 1-2 clinic scale — see
  `07-mvp-roadmap.md` on why we're resisting premature infra
  complexity here

**CRM frontend**
- Next.js app, staff/doctor login, appointment calendar view, patient
  record view, prescription entry (doctor/staff only, never the AI),
  escalation inbox (where escalated conversations land for a human to
  answer)

## Data flow for a typical booking (happy path)

1. Patient sends "I want to book an appointment with Dr. Rao on
   Friday" via WhatsApp
2. Webhook receives message → forwards to Agent layer
3. Agent classifies intent as `book_appointment`, extracts doctor name
   + date (asks a clarifying question if time isn't given)
4. Agent calls `check_availability(doctor_id, date)` tool
5. Backend returns open slots; agent presents them to patient in
   WhatsApp
6. Patient picks a slot; agent calls `book_appointment(...)`
7. Backend writes the appointment, logs the action, triggers a
   confirmation message back through WhatsApp
8. CRM reflects the new appointment immediately (same database, no
   separate sync step needed)

## Data flow for an escalation

1. Patient sends "can I take this with my BP medicine"
2. Agent classifies as clinical-question → immediately calls
   `escalate_to_human(reason, conversation_context)`, does not attempt
   an answer
3. Backend creates an escalation record, notifies staff (in-app + a
   WhatsApp/SMS ping to the on-duty staff number)
4. Patient receives an immediate acknowledgment ("I've passed this to
   Dr. Rao's team, they'll get back to you shortly") — never silence
5. Staff answers directly in the CRM or by calling the patient; the
   AI does not re-enter that conversation thread for that topic

## Why this shape

- Keeping the agent as a thin orchestrator (not the source of truth for
  anything) means the actual booking logic — the part that has to be
  bulletproof against double-booking and race conditions — lives in
  one testable backend, independent of how "smart" the LLM is that day.
- It also means the compliance boundary (agent never sees more than it
  needs, never writes to clinical fields) is enforced structurally, not
  just by prompting the model nicely.
