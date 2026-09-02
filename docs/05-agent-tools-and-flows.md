# Agent Tools & Conversation Flows

## Design rule

The agent is a **thin tool-calling orchestrator, not a freeform
chatbot.** It has a fixed, small set of tools. If no tool fits the
patient's message, the only fallback is `escalate_to_human` — the
agent never free-text-answers something it doesn't have a tool for.

## Tool set (v1)

```
check_availability(doctor_id, date_range)
  → returns open slots

book_appointment(patient_id, doctor_id, slot)
  → creates appointment, returns confirmation

reschedule_appointment(appointment_id, new_slot)
  → validates old appointment belongs to this patient, updates

cancel_appointment(appointment_id)
  → validates ownership, marks cancelled

get_upcoming_appointments(patient_id)
  → read-only, for "when's my next appointment" queries

get_prescription_summary(patient_id)
  → READ-ONLY, returns drug name/dosage/duration exactly as stored.
    No tool exists for writing to this table from the agent side.

escalate_to_human(patient_id, conversation_id, reason)
  → creates an escalation record, notifies staff, sends patient
    acknowledgment
```

Notice there is no `answer_medical_question` tool, no
`modify_prescription` tool, and no general "ask the LLM anything about
health" path. This is intentional — the absence of the tool is the
safety mechanism, not just the prompt wording.

## Intent classification categories

- `book` / `reschedule` / `cancel` — logistics, proceed with tools
- `check_appointment` / `check_prescription_record` — read-only, proceed
- `clinical_question` — e.g. dosage, interactions, side effects,
  symptom advice → **always escalate**
- `emergency_signal` — e.g. chest pain, breathing difficulty, severe
  bleeding → escalate AND immediately tell the patient to seek
  emergency care / call local emergency services; this response is
  templated, not generated, so it's never garbled by the model
- `unclear` — low classifier confidence → escalate rather than guess

## Example conversation: booking (happy path)

```
Patient: Hi, I need an appointment with Dr. Rao
Agent:   Sure! What day works for you?
Patient: This Friday if possible
Agent:   [check_availability] Dr. Rao has openings at 10:00 AM,
         11:30 AM, and 4:00 PM this Friday. Which works for you?
Patient: 11:30 works
Agent:   [book_appointment] You're booked with Dr. Rao on Friday
         at 11:30 AM. We'll send a reminder the day before. Reply
         CANCEL anytime to cancel this booking.
```

## Example conversation: correctly escalated

```
Patient: I'm on the antibiotics Dr. Rao gave me, can I take
         paracetamol with it too?
Agent:   [escalate_to_human — this is a clinical question]
         I'm not able to answer medication questions directly —
         I've passed this to Dr. Rao's team and they'll get back
         to you shortly. If this is urgent, please call the
         clinic directly at [number].
```

## Example conversation: emergency signal

```
Patient: I'm having chest pain right now
Agent:   [escalate_to_human, priority=emergency] If this is a
         medical emergency, please call [local emergency number]
         or go to the nearest emergency room right now. I've also
         alerted the clinic team immediately.
```

## Guardrail checklist for the system prompt

- State the scope boundary explicitly (never clinical, always
  logistics) at the top of the instructions, not buried
- Include 4-6 few-shot examples covering: a normal booking, a
  clinical question, an emergency signal, and an ambiguous case that
  should escalate rather than guess
- Explicitly instruct: "If you are not calling one of your defined
  tools, you must be calling escalate_to_human. There is no third
  option."
- Never pass full patient medical history into the prompt context by
  default — only what's needed for the current tool call (see doc 02
  on minimizing what the LLM API sees)

## Model routing

- Default: cheap/fast model tier for intent classification and slot
  filling (most messages are simple bookings)
- Escalate to a stronger model only for **parsing ambiguous logistics
  phrasing** (e.g. figuring out what date "next Tuesday after my
  usual time" means) — never for clinical reasoning, since clinical
  content routes to a human regardless of model strength
