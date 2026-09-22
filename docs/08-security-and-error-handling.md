# Security, RBAC & Error Handling

This system fails safely by design, not by hoping the LLM behaves. Two
separate enforcement layers exist for every risky action: the
application layer and the database layer. If one has a bug, the other
still holds.

## Role matrix

| Role | Read patients | Read appointments | Write appointments | Read prescriptions | Write prescriptions | Escalation inbox |
|---|---|---|---|---|---|---|
| AI agent (service account) | limited fields only | yes | yes (via tools only) | yes (read-only) | **no** | can create, not resolve |
| Receptionist | yes | yes | yes | yes | **no** | yes |
| Doctor | **his own patients only** | yes (whole clinic, read-only) | yes | yes | yes | **no** — can raise one, cannot work the queue |
| Admin | yes | yes | yes | yes | yes | yes |

The doctor's row is narrower than the others on purpose. An escalation is a
front-desk job: it is a patient waiting on a human reply, and putting it in
front of the doctor as well only splits responsibility for answering it. And
"his own patients" is a filter in the query, not a hidden link — a doctor's
patient list, and every record he can open, is restricted to people who have
an appointment with him at this clinic (`patientScope` in
`src/lib/patients.ts`). He can still see the whole clinic's day, read-only, so
he knows how busy the place is.

Enforce this at the **database role level** (Postgres GRANT/REVOKE),
not only in application code — an application bug should not be able
to grant the agent write access to prescriptions.

## Concurrency safety

- Double-booking prevented by a DB exclusion constraint on
  `(doctor_id, [starts_at, ends_at))` for `status = 'booked'` rows —
  this holds even under concurrent requests, which application-level
  "check then write" logic does not reliably do
- Booking/reschedule/cancel operations are idempotent: retries (e.g.
  from a flaky WhatsApp webhook redelivery) must not create duplicate
  appointments — use a request/message id to dedupe

## Failure modes and required behavior

| Failure | Required behavior |
|---|---|
| LLM API down/times out | Agent falls back to a templated "we're having a technical issue, a staff member will follow up shortly" + auto-escalates, never silently drops the message |
| WhatsApp webhook delivers a message twice | Deduped via message id, second delivery is a no-op |
| Ambiguous intent classification (low confidence) | Escalate, do not guess |
| Reminder job fails to send | Logged, retried with backoff, and if still failing after N attempts, surfaced to staff — a silently-failed medication reminder is a real harm, not just a UX bug |
| Doctor discontinues/changes a prescription | Reminder generation must re-check prescription status at send-time, not just at schedule-time, so a stale reminder is never sent for a discontinued drug |
| Agent about to call a tool with missing/invalid data | Fails the tool call cleanly and asks the patient for the missing info, never calls a tool with guessed data |

## Testing bar (ties into superpowers:test-driven-development)

Before any of the following ships, write the failing test first:

- Double-booking attempt under concurrent requests → must fail at the
  DB level
- Agent asked a clinical question → must escalate, must not call any
  booking tool, must not produce a freeform clinical answer
- Agent's DB role attempting to INSERT/UPDATE `prescriptions` → must be
  rejected at the database permission level, independent of application
  code
- Reminder for a discontinued prescription → must not send
- Duplicate webhook delivery → must not create a duplicate appointment
- Consent not yet granted → booking flow must not proceed past the
  consent step

## Audit logging requirements

Every one of these writes to `audit_log` (doc 04):
- Any read of a `prescriptions` row by anyone other than the owning
  doctor (flag cross-doctor or staff reads for review)
- Every booking/reschedule/cancel, with actor (agent or staff_user id)
- Every escalation created and resolved, with actor
- Every consent grant/withdrawal (already covered by `consent_log`,
  but cross-reference in general audit review)

## Review gate before touching patient-data code

Any PR touching `patients`, `prescriptions`, `appointments`, or the
agent's tool definitions goes through `requesting-code-review` /
`receiving-code-review` before merge — no self-merging on this surface
area, regardless of how small the change looks.
