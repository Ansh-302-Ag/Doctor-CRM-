# Prescription Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No prescription content ever travels over WhatsApp. The patient gets a content-free "your prescription is ready" message with a secure link; the link opens a page on our own site that shows the record only after a one-time code sent to the patient's phone.

**Architecture:** A new `record_links` table holds hashed, expiring link tokens and the current one-time code (hashed, attempt-limited). `src/lib/record-links.ts` owns create / request-code / verify / read. The doctor's save path and the agent's "my prescription" reply both create a link and send it — free-form inside the 24-hour window, an approved Utility template outside it. A public route `/r/[token]` (outside the staff `(crm)` group) asks for the code and then shows the record, read-only, exactly as stored. The code is sent by WhatsApp: free-form inside the window, else an Authentication template.

**Tech Stack:** Next.js 16 App Router (server components, server actions), Postgres via `postgres`, `iron-session`, `node:crypto`, `node:test`.

**Spec:** `docs/02-compliance-dpdp.md` — section "WhatsApp platform policy and Indian law — research, 2026-10-12" (Meta Business Messaging Policy §3: *"Don't use WhatsApp for telemedicine or to send or request any health related information"*), its decision table (prescription contents → secure OTP-gated link; read-back in chat → same link), and docs/01 (the record is shown exactly as the doctor entered it; nothing is interpreted).

## Global Constraints

- **No WhatsApp message — free-form or template, to a patient or to staff — may contain a drug name, dosage, duration or prescription note.** Every task's tests assert this on the bodies they send.
- The record page shows nothing about the patient's health until the code is verified. Before verification it shows only the clinic's name and the code form (WhatsApp fetches links to build previews; that fetch must see nothing).
- Tokens: 32 random bytes from `node:crypto` `randomBytes`, base64url in the URL, **only the SHA-256 hash stored**. Codes: 6 digits from `randomInt`, only the SHA-256 hash stored, compared with `timingSafeEqual`.
- Limits (exact): link valid **7 days**; code valid **10 minutes**; **5** wrong codes lock the link (`locked_at` set); at most **3** codes sent per link per **60 minutes**; a verified view lasts **15 minutes** (session cookie), then the code is needed again.
- A link is dead if expired, locked, or the patient is soft-deleted (`deleted_at` not null) or has withdrawn consent.
- The page renders the record verbatim — the doctor's words only, plus who prescribed it and when — with no added advice (docs/01).
- Every successful view writes `audit(… "read_prescription" …)` with actor `{ kind: "patient", id: <patient id> }` (add the `patient` actor kind to `src/lib/audit.ts` if absent).
- The `/r/[token]` page sends `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, and `<meta name="robots" content="noindex">`.
- Links are built from `APP_URL` (new env var, e.g. `http://localhost:3000` in dev). In production, a missing `APP_URL` is a startup error, never a silent `localhost` link.
- The agent's DB role gets only what it needs on `record_links` (insert, select, update) — granted in the migration, asserted in `tests/safety.test.ts` style.
- No new dependencies. Tests via the Neon test runner (`runtests.sh`), `npx tsc --noEmit` clean, files valid UTF-8.
- Commit per task on branch `prescription-links`, messages ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push.

## Review Focus

- A token guessed or altered by one character → "This link is no longer valid", never another patient's record (Task 1 test).
- A link opened after the patient sent DELETE → dead, no code sent (Task 1 test).
- Six wrong codes in a row → the sixth is refused because the link locked at five; a correct code after locking still fails (Task 1 test).
- A patient outside the 24-hour window asks for a code → the Authentication template is used, not free-form (Task 3 test).
- The doctor saves a prescription for a patient who never messaged the clinic → the `prescription_ready` template goes out, and the doctor's screen says so (Task 3 test).

---

### Task 1: Record links — storage and rules

**Files:**
- Create: `db/011_record_links.sql`, `src/lib/record-links.ts`, `tests/record-links.test.ts`
- Modify: `src/lib/audit.ts` (patient actor kind, if absent), `tests/helpers.ts` (`reset()` truncates `record_links`), `.env.example` (`APP_URL`)

**Interfaces:**
- Produces (all in `src/lib/record-links.ts`):
  - `LINK_TTL_DAYS = 7`, `CODE_TTL_MINUTES = 10`, `MAX_WRONG_CODES = 5`, `MAX_CODES_PER_HOUR = 3`, `VIEW_MINUTES = 15`
  - `createRecordLink(db: Db, patientId: string, now?: Date): Promise<{ token: string; url: string; expiresAt: Date }>` — `url = ${APP_URL}/r/${token}`
  - `issueCode(db: Db, token: string, now?: Date): Promise<{ ok: true; code: string; phone: string; clinicName: string; patientId: string } | { ok: false; reason: "invalid" | "rate_limited" }>` — stores the code's hash and expiry; the caller sends it
  - `verifyCode(db: Db, token: string, code: string, now?: Date): Promise<{ ok: true; patientId: string; linkId: string } | { ok: false; reason: "invalid" | "wrong_code" | "expired_code" | "locked" }>`
  - `readRecord(db: Db, linkId: string, now?: Date): Promise<{ clinicName: string; clinicPhone: string | null; patientName: string | null; prescriptions: { drugName: string; dosage: string; durationDays: number | null; notes: string | null; status: string; doctorName: string; createdAt: Date }[] } | null>` — null when the link is dead; writes the patient-actor audit row
  - `linkClinicName(db: Db, token: string): Promise<string | null>` — for the pre-verification page; null when dead

Migration `db/011_record_links.sql`: table `record_links (id uuid pk, patient_id uuid not null references patients(id) on delete cascade, token_hash text not null unique, expires_at timestamptz not null, code_hash text, code_expires_at timestamptz, wrong_codes int not null default 0, codes_sent_at timestamptz[] not null default '{}', locked_at timestamptz, created_at timestamptz not null default now())`; `grant select, insert, update on record_links to clinic_agent`.

- [ ] **Step 1: Write the failing tests** in `tests/record-links.test.ts`:
  - `"a link stores only a hash of its token"` — `createRecordLink` → the DB row's `token_hash` ≠ token and = sha256(token) hex; `url` ends with `/r/${token}`.
  - `"a code is issued for a live link and verifies once"` — `issueCode` ok → `verifyCode` with that code ok and returns the patient id; the same code again → `wrong_code` (code is single-use: clear `code_hash` on success).
  - `"a wrong or altered token is invalid"` — token with one character changed → `issueCode` `{ ok: false, reason: "invalid" }`, `linkClinicName` null.
  - `"an expired link, a deleted patient, or withdrawn consent kills the link"` — three cases → `issueCode` invalid.
  - `"five wrong codes lock the link"` — five wrong → fifth returns `locked`; then the correct code → `locked`.
  - `"a code expires after ten minutes"` — verify at `now + 11 min` → `expired_code`.
  - `"no more than three codes an hour"` — fourth `issueCode` within 60 min → `rate_limited`; at +61 min → ok.
  - `"reading the record writes a patient audit row and returns the doctor's words unchanged"` — a prescription with notes → `readRecord` returns it verbatim; one `audit_log` row with actor = patient id and action `read_prescription`.
  - `"the agent role can create a link"` — `createRecordLink(agentDb, …)` succeeds (grant check).
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** the migration and module. Apply the migration to the test DB through the runner (it migrates); apply to the dev DB with `npm run migrate` only after tests pass.
- [ ] **Step 4: Run to verify they pass**; tsc clean.
- [ ] **Step 5: Commit** — `feat: record links — hashed, expiring, code-protected access to a patient's prescriptions`.

---

### Task 2: Templates for the link and the code

**Files:**
- Modify: `src/lib/templates.ts`, `src/lib/channel.ts` (`sendTemplate`), `docs/10-whatsapp-templates.md`
- Test: `tests/templates.test.ts`, `tests/channel.test.ts`

**Interfaces:**
- Produces: template names `prescription_ready` and `record_code`; `TemplateSpec` gains `category: "utility" | "authentication"` (existing templates are `utility`); `record_updated` is removed (its only sender is replaced in Task 3).

Exact copy:
- `prescription_ready` (Utility, `en`), params `["clinic_name", "doctor_name", "link"]`, body:
  `Hello from {{1}}. {{2}} has added a prescription to your record. View it securely here: {{3}} — the page will send a code to this number.`
- `record_code` (Authentication, `en`), params `["code"]`. Meta fixes authentication template wording; register it in Meta with the "copy code" button. Our `bodyText` for docs and preview: `{{1}} is your verification code.` `sendTemplate` for an `authentication` template sends the body parameter AND a button component: `{ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] }` (check Meta's current authentication-template send docs before coding and follow them if they differ; record what you used in the report).

- [ ] **Step 1: Write the failing tests** — `tests/templates.test.ts`: the existing clinical-vocabulary and start/end-variable checks cover the new bodies (the em-dash text after `{{3}}` keeps the body from ending on a variable); add `"no template is about health content"`: no body contains `dosage`, `drug`, `medicine`, `tablet`. `tests/channel.test.ts`: `"an authentication template sends the code as body and button parameter"` — stub fetch, assert the JSON has both components with the code.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement**; update `docs/10` (two new sections verbatim, remove `record_updated`, status rows "not yet submitted").
- [ ] **Step 4: Run to verify they pass**; tsc clean.
- [ ] **Step 5: Commit** — `feat: templates for a secure prescription link and its code`.

---

### Task 3: Send the link, never the record

**Files:**
- Modify: `src/lib/doctor.ts` (`prescribeAndNotify`/`deliver`; delete `prescriptionMessage`), `src/lib/agent/index.ts` (`check_prescription_record`), `src/lib/agent/tools.ts` only if the agent needs a link tool, `src/app/(crm)/patients/[id]/page.tsx` (notices and copy), `src/lib/consent.ts` only if notice copy mentions read-back (it must not change `CONSENT_NOTICE` text)
- Test: `tests/doctor.test.ts`, `tests/agent.test.ts`

**Interfaces:**
- Consumes: `createRecordLink` (Task 1), templates `prescription_ready` (Task 2).
- Produces: `Delivery` keeps its shape (`delivered`, `reason?: "outside_window" | "send_failed"`, `nudged?`) — `nudged` now means "the `prescription_ready` template went out".

Behaviour:
- After the prescription row is committed: `createRecordLink(db, patientId)`. Inside the 24-hour window → `sendMessage` with exactly the `prescription_ready` body rendered (same words as the template). Outside → `sendTemplate("prescription_ready", [clinic, doctor, url])`. Errors never propagate; audit actions unchanged in name (`prescription_message_sent` / `_deferred` / `_failed`).
- Agent `check_prescription_record`: no active prescriptions → unchanged reply. Otherwise create a link and reply: `You can view your prescriptions securely here: ${url} — the page will send a code to this number. For any question about them, please speak to the clinic team.`
- Patient record page copy (doctor/admin form and notices) — exact strings:
  - form footnote: `Saved exactly as typed and attributed to you. The patient gets a secure link on WhatsApp to view it — the prescription itself is never sent in chat.`
  - button: `Save & notify patient`
  - notice when sent in window: `Prescription saved. The patient was sent a secure link to view it.`
  - notice outside window: `Prescription saved. The patient was sent a “your prescription is ready” message with a secure link.` (or the existing failure notice when the template did not go out)
  - section caption: `Stored exactly as entered. Patients see them through a secure, code-protected link — never in chat.`

- [ ] **Step 1: Write the failing tests:**
  - `tests/doctor.test.ts`: update the window tests — inside the window the sent text contains `/r/` and contains neither the drug name nor the dosage; outside the window `sendT` is called with `prescription_ready` and a parameter containing `/r/`; a `record_links` row exists for the patient.
  - `tests/agent.test.ts`: `"'my prescription' sends a secure link, never the record"` — with an active prescription, the reply matches `/\/r\//` and does not contain the drug name or dosage.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `tests/doctor.test.ts tests/agent.test.ts tests/inbound.test.ts`, then the full suite once; tsc clean.
- [ ] **Step 5: Commit** — `fix: prescriptions reach the patient as a secure link, never as WhatsApp text`.

---

### Task 4: The patient's record page

**Files:**
- Create: `src/app/r/[token]/page.tsx` (and a colocated server-actions module if the codebase pattern prefers it), `src/lib/record-session.ts` (iron-session cookie `record_view`, separate from the staff cookie, `maxAge` = `VIEW_MINUTES * 60`, `httpOnly`, `sameSite: "lax"`, `secure` in production)
- Modify: `next.config.ts` (headers for `/r/:path*`: `Cache-Control: no-store`, `Referrer-Policy: no-referrer`) — read `node_modules/next/dist/docs/` for the current `headers()` config shape first
- Test: `tests/record-links.test.ts` (any new lib function); the page itself is checked in the browser by the controller

**Interfaces:**
- Consumes: `linkClinicName`, `issueCode`, `verifyCode`, `readRecord` (Task 1); `sendMessage`, `sendTemplate` (`record_code`), `WINDOW_MS` from `src/lib/doctor.ts` (or move the window check into a small shared helper rather than duplicating it).

Page states (mobile-first, existing design tokens, `Doctor-CRM` not shown — this page belongs to the clinic, so the clinic's name heads it):
1. Dead link → `This link is no longer valid. Ask the clinic for a new one, or message us “my prescription” on WhatsApp.`
2. Live, not verified → clinic name, `To see your prescription, we’ll send a 6-digit code to your WhatsApp number ending ••NN.` and a `Send code` button (server action → `issueCode` → send: free-form `Your code for ${clinic} is ${code}. It expires in 10 minutes.` inside the window, else the `record_code` template). Rate-limited → `Too many codes. Try again in an hour.`
3. Code sent → a 6-digit input (`inputMode="numeric"`, `autoComplete="one-time-code"`, labelled) and `View prescription`. Wrong → `That code isn’t right. N tries left.`; expired → `That code has expired. Send a new one.`; locked → state 1's message.
4. Verified (cookie holds the link id and expiry) → clinic name, patient name, then each prescription: drug name, dosage, duration, notes, status badge, prescribed by, date — verbatim; then `For any question about this, call the clinic on ${phone}.` and a `Print` button (`window.print()` via a tiny client component). No other text.

- [ ] **Step 1: Implement** the session helper, the page with its four states, the server actions, and the headers.
- [ ] **Step 2: Verify** — tsc clean; runtests on `tests/record-links.test.ts tests/source-encoding.test.ts`; with `curl -I` against the dev server confirm `Cache-Control: no-store` and `Referrer-Policy: no-referrer` on `/r/anything`.
- [ ] **Step 3: Commit** — `feat: a code-protected page where patients view their prescriptions`.

(The controller then walks the whole flow in the browser on the dev database — save a prescription as the doctor, open the link, request a code, enter it, view, print — at 375px and 1366px.)

---

### Task 5: Documentation catches up

**Files:** `docs/02-compliance-dpdp.md` (decision table: mark the two prescription rows as done, link this plan), `docs/11-product-overview.md` (prescription rows → Available, describe the link flow), `docs/09-implementation-log.md` (dated entry; templates `prescription_ready` and `record_code` need Meta approval; `APP_URL` must be set in every deployment), `.env.example` (already has `APP_URL` from Task 1 — check).

- [ ] **Step 1: Edit the docs** (dated note at the bottom of any file whose decision changed, per docs/00).
- [ ] **Step 2: Commit** — `docs: prescriptions are delivered by secure link`.
