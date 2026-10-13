# Live WhatsApp Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the ten defects found by the 2026-10-13 dry run and the first live Meta test, so a real patient's message is never silently lost, mis-answered, or left unpaged.

**Architecture:** Per-message webhook handling moves out of the route into `src/lib/inbound.ts`, which takes its senders as parameters so tests can drive it against the test database without Meta. Parsing is made per-message and lossless in `src/lib/webhook.ts`. Staff paging moves to an approved-template path with a free-form fallback. Conversation fixes stay inside the existing agent state machine.

**Tech Stack:** TypeScript, Next.js 16 route handlers, Postgres via `postgres`, zod, `node:test` via `tsx`.

**Spec:** `docs/09-implementation-log.md` — entries "2026-10-13 — pre-live dry run" (bugs 1–7) and the live-test findings (false reminder promise, "OK" not consent, confirmation without doctor); `docs/02-compliance-dpdp.md` "WhatsApp platform policy and Indian law" (no health information in WhatsApp text we send to staff).

## Global Constraints

- `screen()` runs before any model on every patient text, including media captions, and its verdict cannot be overridden (docs/01, docs/05).
- Ambiguity resolves toward the human; but a message we cannot read is answered honestly, not escalated as if a person will follow up (dry-run bug 5).
- Staff pages carry no patient message text and no full phone number — `mask(phone)` only (docs/02 health-information clause; Meta 4096-char limit).
- Every inbound message is either answered, or logged with `console.error` and paged — never dropped with a 200 and no trace (docs/08 failure modes).
- Tests before implementation for everything here (docs/00 principle 3). Suite runs with `--test-concurrency=1`.
- Template copy must pass `tests/templates.test.ts`'s clinical-vocabulary ban and be copied verbatim into `docs/10-whatsapp-templates.md`.
- No new dependencies.
- Commit only with the user's go-ahead (standing instruction this session).

## Review Focus

- A Meta payload mixing one normal message with one lacking `from` → the normal one is still answered (Task 1 test).
- The `staff_alert` template not yet approved by Meta (sync error) → page falls back to free-form text, and if that also fails, `console.error`, never a throw into the request (Task 2 test).
- A text consisting only of "👍" or "हाँ" while consent is pending → counts as consent (Task 4 test).
- An image whose caption is an emergency ("chest pain") → emergency template and an `emergency` escalation, exactly as for a text (Task 3 test).
- The same non-text message delivered twice → one stored row, one reply (Task 3 test).

---

### Task 1: Lossless, per-message webhook parsing

**Files:**
- Modify: `src/lib/webhook.ts` (schema and `parseInbound`)
- Test: `tests/webhook.test.ts`

**Interfaces:**
- Produces:
  - `type InboundText = { phone: string; body: string; providerMessageId: string }` (unchanged)
  - `type InboundOther = { phone: string; providerMessageId: string; kind: string }`
  - `type FailedStatus = { messageId: string; recipient: string; code: number | null; title: string }`
  - `parseInbound(body: unknown): { texts: InboundText[]; unsupported: InboundOther[]; failed: FailedStatus[]; unidentified: number }`

Rules `parseInbound` must implement:
- Validate the envelope loosely, then each message on its own; one bad message never discards its neighbours.
- `type: "text"` → `texts`.
- `image` / `video` / `document` **with** a non-empty `caption` → `texts`, `body` = the caption.
- `reaction` and `system` → skipped entirely (no reply, no page).
- `type: "unsupported"` → `unsupported` with `kind` = `unsupported.type` if present (e.g. `"edit"`), else `"unsupported"`.
- Any other type (image without caption, audio, sticker, location, contacts, interactive, button…) → `unsupported` with `kind` = the type.
- A message with no `from` (or failing per-message validation) → counted in `unidentified`.
- `value.statuses[]` entries with `status: "failed"` → `failed`, `code`/`title` from `errors[0]`.

- [ ] **Step 1: Write the failing tests** in `tests/webhook.test.ts` (keep the existing ones; update the "non-text" one to expect `kind: "image"` and the empty-payload one to expect the four-key shape):
  - `"a message without from is counted, and does not discard its neighbour"` — envelope with `[{from:"919000000001",id:"w1",type:"text",text:{body:"hi"}}, {from_user_id:"IN.123",id:"w2",type:"text",text:{body:"hello"}}]` → `texts.length === 1`, `texts[0].providerMessageId === "w1"`, `unidentified === 1`.
  - `"reactions and system messages are ignored"` — `type:"reaction"` and `type:"system"` → all four outputs empty / 0.
  - `"an edit arrives as unsupported with kind edit"` — `{type:"unsupported", unsupported:{type:"edit"}}` → `unsupported[0].kind === "edit"`.
  - `"a media caption is read as text"` — `{type:"image", image:{id:"m1", caption:"severe chest pain"}}` → `texts[0].body === "severe chest pain"`; same image without caption → `unsupported[0].kind === "image"`.
  - `"failed delivery statuses are surfaced"` — `value: { statuses: [{id:"wamid.out", status:"failed", recipient_id:"919000000001", errors:[{code:131047, title:"Re-engagement message"}]}] }` → `failed` deep-equals `[{ messageId:"wamid.out", recipient:"919000000001", code:131047, title:"Re-engagement message" }]`; a `delivered` status → `failed` empty.

- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/webhook.test.ts` → the new tests FAIL.
- [ ] **Step 3: Implement** in `src/lib/webhook.ts`. Use zod per message (`safeParse` inside the loop); phone stays `+${from.replace(/^\+/, "")}`.
- [ ] **Step 4: Run to verify they pass** — `npm test -- tests/webhook.test.ts` → all PASS.
- [ ] **Step 5: Commit** (with go-ahead) — `fix: parse webhook messages one at a time and keep what was dropped`.

---

### Task 2: Staff alerts through an approved template

**Files:**
- Modify: `src/lib/templates.ts` (add `staff_alert`), `src/lib/channel.ts` (`notifyStaff`), `src/lib/reminders.ts` (page when a reminder exhausts its retries), `docs/10-whatsapp-templates.md`
- Test: `tests/templates.test.ts` (existing checks cover the new template automatically), new `tests/channel.test.ts`, `tests/reminders.test.ts`

**Interfaces:**
- Consumes: `sendTemplate`, `sendMessage`, `mask` in `src/lib/channel.ts`.
- Produces:
  - `type StaffAlert = { clinicName: string; urgent: boolean; note: string }` exported from `src/lib/channel.ts`
  - `notifyStaff(alert: StaffAlert): Promise<void>` — never throws.

Template, exact copy (Utility, `en`):
- name `staff_alert`, params `["clinic_name", "priority"]`
- body: `{{1}}: a patient conversation needs a person ({{2}}). Please open the escalation inbox in the clinic dashboard.`
- `priority` is the string `urgent` or `routine`.

Behaviour: with `STAFF_NOTIFY_PHONE` unset → existing `console.warn`, return. Otherwise `sendTemplate({ to, name: "staff_alert", parameters: [clinicName, urgent ? "urgent" : "routine"] })`; if that throws (template not yet approved, 132001), `sendMessage({ to, text: note })`; if that throws too, `console.error("[staff-notify] could not page staff", …)`. `note` is written by callers and must contain no patient message text — callers use `mask(phone)`.

- [ ] **Step 1: Write the failing tests** in `tests/channel.test.ts`, stubbing `globalThis.fetch` (pattern: `tests/intent.test.ts`) with `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `STAFF_NOTIFY_PHONE` set in the test and restored in `finally`:
  - `"staff alert is sent as the staff_alert template"` — fetch records one call whose JSON body has `type:"template"`, `template.name:"staff_alert"`, parameters `["Sunrise Clinic","urgent"]`.
  - `"an unapproved template falls back to free-form text"` — first fetch returns 400 `{"error":{"code":132001}}`, second returns 200 → two calls, second has `type:"text"` and `text.body === note`.
  - `"if both sends fail, notifyStaff resolves without throwing"` — both 500 → `await notifyStaff(...)` resolves.
  - In `tests/reminders.test.ts`, extend the existing retry-exhaustion test (the one asserting an escalation row after `MAX_ATTEMPTS`) to also assert that a stubbed `notifyStaff` — injected as a new optional last parameter of `runDueReminders(db, now?, send?, notify = notifyStaff)` — was called once with `urgent: false`.
- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/channel.test.ts tests/reminders.test.ts tests/templates.test.ts`.
- [ ] **Step 3: Implement** the template, `StaffAlert`/`notifyStaff`, and the reminders page (note text: `Reminder to ${mask(phone)} could not be delivered after ${MAX_ATTEMPTS} attempts.`). Check the existing `runDueReminders` signature first and add the notifier as its last optional parameter. Add the `staff_alert` section and status row to `docs/10-whatsapp-templates.md`, body copied verbatim from `templates.ts`.
- [ ] **Step 4: Run to verify they pass** — same command → PASS.
- [ ] **Step 5: Commit** (with go-ahead) — `fix: page staff with an approved template, falling back to text`.

---

### Task 3: Per-message processing with honest failure handling

**Files:**
- Create: `src/lib/inbound.ts`
- Modify: `src/lib/agent/index.ts` (`InboundMessage.kind`, `Reply.urgent`, unreadable-message short-circuit), `src/app/api/webhook/whatsapp/route.ts` (thin: verify, parse JSON, delegate)
- Test: create `tests/inbound.test.ts`; extend `tests/agent.test.ts`

**Interfaces:**
- Consumes: `parseInbound` and types from Task 1; `StaffAlert`, `mask`, `Outbound` from Task 2 / `channel.ts`; `handleInbound`, `Classifier`.
- Produces:
  - `InboundMessage` gains `kind?: string` (absent = typed text).
  - `Reply = { text: string; escalated: boolean; urgent?: boolean }` — `urgent` true when the escalation priority was `emergency`.
  - `type Senders = { sendMessage(m: Outbound): Promise<{ delivered: boolean }>; notifyStaff(a: StaffAlert): Promise<void> }`
  - `processWebhook(pool: Pool, payload: unknown, clinicId: string, senders: Senders, classify?: Classifier): Promise<{ received: number }>`

`handleInbound` with `kind` set: dedupe and store the inbound row exactly as today with `body = "[" + kind + "]"`, then return without classifying or paging:
- `kind === "edit"` → `Edited messages can't be read here. Please send your message again as a new message.`
- otherwise → `I can only read typed messages. Please type what you need, for example "book an appointment".`

`processWebhook` per message (texts and unsupported alike), in this order:
1. `reply = await handleInbound(...)`. If it throws: `console.error`, best-effort `sendMessage(technicalFailure)`, `notifyStaff({ urgent:false, note:"Could not process a message from " + mask(phone) + ". Check the server logs." })`. Next message.
2. `reply === null` (duplicate) → next message.
3. If `reply.escalated` → `notifyStaff({ urgent: !!reply.urgent, note: (reply.urgent ? "URGENT: " : "") + "Escalation from " + mask(phone) + ". Open the escalation inbox." })` **before** replying to the patient.
4. `sendMessage({ to: phone, text: reply.text })` in its own try; on failure `console.error` and `notifyStaff({ urgent: !!reply.urgent, note: "Reply to " + mask(phone) + " could not be delivered. Contact the patient directly." })`. Never send `technicalFailure` here — the booking already happened.

Then: each `failed` status → `console.error("[whatsapp] delivery failed", mask(recipient), code, title)`; `unidentified > 0` → `console.error` and one `notifyStaff({ urgent:false, note:"A WhatsApp user without a visible phone number messaged the clinic and could not be answered." })`. Clinic name for alerts is read from `clinics` by `clinicId`. Returns `{ received: texts.length + unsupported.length }`.

Route: invalid JSON with a valid signature → `400`; missing `CLINIC_ID` → `500` as today; otherwise `NextResponse.json(await processWebhook(agentSql, parsed, clinicId, { sendMessage, notifyStaff }))`.

- [ ] **Step 1: Write the failing tests.** In `tests/inbound.test.ts` (test db from `tests/helpers.ts`, `scripted` classifier, senders that record calls and can be told to throw; build payloads with a local `envelope(messages)` helper like `tests/webhook.test.ts`):
  - `"a reply that fails to send does not tell the patient there was a technical issue"` — text "I need an appointment with Dr. Rao" from the seeded patient, `sendMessage` throws → `sendMessage` called exactly once (no second, technical-failure call), `notifyStaff` called once with a `note` matching `/could not be delivered/`, and the stored outbound row exists.
  - `"an emergency caption on an image escalates as an emergency"` — `{type:"image", image:{id:"m1", caption:"chest pain"}}` → one escalation row with `priority = 'emergency'`, `notifyStaff` called with `urgent: true` before `sendMessage`, patient reply matches `/112/`.
  - `"an image without caption gets the typed-messages reply, once, and pages nobody"` — same `id` delivered twice → `sendMessage` called once with text matching `/only read typed messages/`, `notifyStaff` never called, one inbound row with body `[image]`.
  - `"a reaction produces no reply and no page"` → both recorders empty.
  - `"staff pages never contain the patient's words or full number"` — clinical text "can I take paracetamol with my BP medicine" → `notifyStaff` note does not contain `paracetamol` and does not contain `919000000001`.
  - `"a payload missing from is paged, not silently dropped"` → `notifyStaff` called once with `/without a visible phone number/`.
- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/inbound.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `src/lib/inbound.ts`, the `kind` short-circuit and `Reply.urgent` in `src/lib/agent/index.ts` (the `escalate` helper knows the priority), and slim the route.
- [ ] **Step 4: Run to verify they pass** — `npm test -- tests/inbound.test.ts tests/agent.test.ts tests/webhook.test.ts` → PASS.
- [ ] **Step 5: Commit** (with go-ahead) — `fix: never mislead a patient or lose a page when a WhatsApp send fails`.

---

### Task 4: Conversation fixes

**Files:**
- Modify: `src/lib/agent/index.ts` (stash at the consent and name detours, consent short-circuit, confirmation copy), `src/lib/consent.ts` (`isAffirmative`, introduction copy), `src/lib/reminders.ts` (`scheduleAppointmentReminder` returns whether it scheduled), `src/lib/booking.ts` (book and reschedule return `reminderScheduled`)
- Test: `tests/agent.test.ts`, `tests/booking.test.ts`

**Interfaces:**
- Produces:
  - `isAffirmative(body: string): boolean` in `src/lib/consent.ts` — true for, after lower-casing and trimming punctuation/whitespace: `yes`, `y`, `ok`, `okay`, `k`, `sure`, `agree`, `i agree`, `yes i agree`, `haan`, `han`, `ha`, `haa`, `ji`, `haan ji`, `ji haan`, `हाँ`, `हां`, `👍`. Nothing else (no substring matching — "ok but not today" is false).
  - `scheduleAppointmentReminder(...): Promise<boolean>`
  - `bookAppointment` / `rescheduleAppointment` results gain `reminderScheduled: boolean`.

Changes:
1. The pending-request stash at the consent detour and the name detour keeps an existing `pending` instead of overwriting it: `pending: state.pending ?? msg.body` (both sites).
2. When the patient's consent is not `granted` and `isAffirmative(msg.body)`, treat the message as `consent_yes` without calling the classifier.
3. Booking/reschedule confirmation: `You are booked with ${doctorName} for ${time}.` (drop `with …` if the doctor name is unknown) + ` We will send a reminder the day before.` only when `reminderScheduled` + ` Reply CANCEL anytime to cancel.`
4. `introduction()`: remove the promise to "read back what the doctor has already prescribed" (docs/02). `CONSENT_NOTICE` is unchanged, so `NOTICE_VERSION` is not bumped.

- [ ] **Step 1: Write the failing tests** in `tests/agent.test.ts` (new patient phones so consent/name start empty):
  - `"a non-answer to the name question does not replace the stashed request"` — classifier stub returning `book` with doctor "Dr. Rao" and tomorrow for the request, `book` with nothing for `"1"`, `provide_name` "Asha" for the name; after the name the reply matches `/these times are free/i` (not `/which doctor/i`).
  - `"'ok', 'haan' and a thumbs-up count as consent even when the model says unclear"` — classifier `stub(() => ({}))`; for each of `"ok"`, `"haan"`, `"👍"` on a fresh phone after `"hi"` → reply matches `/thank you/i` and the patient's `consent_status = 'granted'`.
  - `"'ok but not today' is not consent"` → consent stays `pending`.
  - `"the confirmation names the doctor and only promises a reminder that exists"` — book a slot later today (inside the lead time) → text matches `/with Dr\. Rao/` and does not match `/reminder/`; book `futureSlot(10, 3)` → matches `/reminder the day before/`.
  - `"the introduction does not offer to read prescriptions"` → first reply to `"hi"` from a new phone does not match `/prescri/i` outside the consent notice text (assert on `introduction(...)` minus `CONSENT_NOTICE`).
  - In `tests/booking.test.ts`: `"bookAppointment reports whether a reminder was scheduled"` — slot 3 days ahead → `reminderScheduled === true`; slot within the lead time → `false`.
- [ ] **Step 2: Run to verify they fail** — `npm test -- tests/agent.test.ts tests/booking.test.ts`.
- [ ] **Step 3: Implement** the four changes.
- [ ] **Step 4: Run the whole suite** — `npm test` (or the Neon `neondb_test` path documented in docs/09 if the local cluster cannot start) and `npx tsc --noEmit` → all PASS, 0 type errors.
- [ ] **Step 5: Record and commit** — append a dated entry to `docs/09-implementation-log.md` listing which of the ten defects are fixed and that `staff_alert` still needs Meta approval; update the template status row in `docs/10`. Commit (with go-ahead) — `fix: keep the request through detours, accept plain yes, confirm honestly`.

---

## Deferred (minor, logged in docs/09, not in this plan)

Stale redeliveries after an outage processed as fresh; 24-hour window measured from insert time; transient failures before commit forfeit Meta's redelivery; SMS staff alerts (Fast2SMS) as an alternative channel.
