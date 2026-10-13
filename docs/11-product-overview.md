# Doctor-CRM — Product Overview

What Doctor-CRM does, explained feature by feature. This is the plain-language
description of the product — for the website, sales conversations, and anyone
new to the project. For how it is built, see docs 03–08; for what is built
today versus planned, see `docs/09-implementation-log.md`.

Every feature below is marked:

- **Available** — built and tested today
- **Planned** — designed, not built yet

---

## In one paragraph

Doctor-CRM is a WhatsApp front desk plus a clinic management dashboard for
independent clinics in India. Patients book, reschedule and cancel
appointments by messaging the clinic's own WhatsApp number. Doctors and staff
manage appointments, patients and prescription records from a web dashboard.
The assistant handles logistics only — every clinical decision stays with the
doctor, and anything medical goes to a human.

## The one rule the whole product is built around

> **Doctor-CRM handles logistics. The doctor makes every clinical decision.**

The assistant books, reschedules, cancels, reminds, records and routes. It
never diagnoses, never advises on medication or dosage, never decides whether
something is urgent, and never edits a prescription. If a message could be
read as medical, it goes to a human at the clinic — ambiguity always resolves
toward the human. This is enforced three ways, not just by instruction:
there is no feature that can answer a medical question, a safety check runs
before any automation, and the assistant's database access physically cannot
write prescription records (docs/01, docs/08).

---

## Who uses it

| User | Where | What they do |
|---|---|---|
| Patient | WhatsApp | Books and manages appointments, receives reminders and prescription records |
| Receptionist | Dashboard | Runs the calendar, handles the escalation inbox, manages patients |
| Doctor | Dashboard | Sees their own queue, opens their patients' records, writes prescriptions |
| Clinic admin | Dashboard | Everything above |

---

## Part 1 — The WhatsApp assistant (for patients)

Patients message the clinic's WhatsApp number; nothing to install. The
assistant can run in two modes. Both share the same booking engine, safety
check, consent flow and dashboard — only the way the patient *chooses* things
differs.

### Mode A — AI chatbot (natural language) — **Available**

The patient types the way they normally would, and the assistant understands
it.

```
Patient:   Hi, I need an appointment with Dr. Rao
Assistant: Sure! What day works for you?
Patient:   This Friday if possible
Assistant: Dr. Rao has openings on Friday:
           1. 10:00 am
           2. 11:30 am
           3. 4:00 pm
           Which works for you?
Patient:   the 2nd one
Assistant: You're booked with Dr. Rao on Friday at 11:30 am.
           We'll send a reminder before your visit.
```

- Understands free text: doctor names, days ("tomorrow", "this Friday"),
  and which offered slot the patient picked ("the 2nd one", "11:30").
- Asks a clarifying question when something is missing — which doctor, which
  day — instead of guessing.
- If it still cannot understand after a couple of tries, it hands the
  conversation to the clinic team rather than booking the wrong thing.
- Keeps everything the patient already said while it asks for the rest.
- The AI only ever sees the message, the clinic's doctor names, the times just
  offered and today's date — never the patient's history or prescriptions.
- If the AI service is down, the patient is told a staff member will follow
  up, and the clinic is alerted. Messages are never silently dropped.

### Mode B — Menu-based (tap to choose) — **Planned**

The patient taps buttons and picks from lists instead of typing. Uses
WhatsApp's built-in interactive messages; no AI involved, so it is faster,
cheaper and cannot misread anyone.

```
Patient:   hi
Assistant: Welcome to Sunrise Clinic. Choose your language:
           [ हिंदी ]  [ English ]

Assistant: How can we help?
           ▸ Book appointment
           ▸ My appointments
           ▸ My prescription
           ▸ Talk to the clinic

Patient:   taps "Book appointment"
Assistant: Choose a doctor        ▸ Dr. Rao — General Medicine
                                  ▸ Dr. Iyer — Paediatrics
Assistant: Choose a day           ▸ Today ▸ Tomorrow ▸ Fri 9 Oct …
Assistant: Choose a time          ▸ 10:00 ▸ 10:30 ▸ 11:30 … ▸ More times

Assistant: Request sent to Sunrise Clinic. We'll confirm shortly.
   (receptionist confirms in the dashboard)
Assistant: ✅ Confirmed — Dr. Rao, Fri 9 Oct, 10:30 am.
           Your token number: 7

Later:     Now serving token 5. You are 2 away.
```

**Main menu**

| Option | What happens |
|---|---|
| Book appointment | Doctor → day → time slot → request or instant booking |
| My appointments | Shows upcoming appointments, with Reschedule / Cancel |
| My prescription | Sends a secure link to the doctor's record — never the contents in chat |
| Talk to the clinic | Hands the conversation to the front desk |

**Notes on the design**

- **Language first.** Hindi and English to start; every menu text is fixed and
  translated once by a person, not generated.
- **"My prescription", never "know dosage".** It sends a secure, OTP-gated
  link to exactly what the doctor wrote — WhatsApp's policy forbids sending
  health information in chat (docs/02). It never explains or advises;
  follow-up questions go to "Talk to the clinic".
- **Typing still works safely.** If a patient types instead of tapping, the
  same safety check runs first (emergencies and medical questions go to a
  human); anything else gets the menu again.
- **Token numbers and "now serving" updates** — a waiting number per doctor
  per day, and live queue updates from the doctor's screen.
- **Clinic confirmation (optional per clinic)** — bookings can confirm
  instantly when the slot is free, or wait for the receptionist to approve.
- WhatsApp limits shape the menus: up to 3 buttons, up to 10 list rows (so
  longer lists get a "More" option).

### What the assistant does in both modes

| Feature | Status |
|---|---|
| Book an appointment | Available |
| Reschedule an appointment | Available |
| Cancel an appointment | Available |
| "When is my appointment?" | Available |
| Prescription record via a secure link (replaces reading it back in chat) | Planned — current in-chat read-back to be removed (docs/02) |
| "Your prescription is ready" notice when the doctor saves it | Planned — replaces sending the contents (docs/02) |
| Appointment reminder before the visit | Available (needs Meta template approval to send) |
| Ask for and remember the patient's name on first contact | Available |
| Refill / follow-up reminder when a course is ending | Built, switched off until the clinic chooses the timing |
| Hindi and other languages | Planned |
| Token numbers and "now serving" updates | Planned |

### Safety, in both modes

- **Emergency detection.** A message describing an emergency — chest pain,
  difficulty breathing, heavy bleeding, including common Hinglish phrasing —
  immediately gets a fixed reply telling the patient to call emergency
  services or go to the nearest emergency room, and the clinic is alerted.
  This reply is a fixed template, never generated. **Available**
- **Medical questions go to a human.** "Can I take this with my BP medicine?"
  is never answered. The patient is told the clinic team will get back to
  them, and the conversation lands in the escalation inbox. **Available**
- **The safety check runs before anything else**, uses no AI, and cannot be
  overridden by any later step. **Available**
- **Consent before booking.** A new patient is shown what data is collected
  and why, and must agree before any booking. Consent is recorded with the
  version of the notice they saw. **Available**
- **Delete my data.** A patient can ask on WhatsApp to withdraw consent;
  their appointments are cancelled and their records are deleted after the
  retention period. **Available** (a confirmation step is planned)
- **Duplicate messages are ignored**, so a message WhatsApp delivers twice
  can never create two bookings. **Available**

---

## Part 2 — The clinic dashboard (for staff)

A web app; staff sign in with email and password.

| Screen | Who | What it does | Status |
|---|---|---|---|
| Clinic calendar | All staff | The day's appointments across every doctor | Available |
| Doctor's queue | Doctor | Their own day in time order, with the next patient highlighted | Available |
| Patients | All staff (doctors: own patients only) | Search patients, open a patient's record | Available |
| Patient record | All staff | Appointment history and prescriptions | Available |
| Prescription entry | Doctor, admin | Record drug, dosage, duration and notes; the patient is notified it is ready | Available (notification changing — see below) |
| Discontinue a prescription | Doctor, admin | Marks it stopped; any pending reminder for it will not send | Available |
| Escalation inbox | Receptionist, admin | Every conversation that needs a human; acknowledge and resolve | Available |
| Book / reschedule / cancel from the dashboard | Staff | For walk-ins and phone bookings | Planned |
| Confirm booking requests | Receptionist | Approve patient requests (Mode B) | Planned |
| Mark completed / no-show | Staff | Close out the day | Planned |
| Reply to a patient from the inbox | Receptionist | Answer escalations without leaving the dashboard | Planned |
| "Now serving" control | Doctor | Advance the token queue | Planned |
| Staff management | Admin | Add and remove staff accounts | Planned |
| Connect WhatsApp | Clinic admin | Link the clinic's own number in a few minutes | Planned |

### Prescriptions, specifically

- Only doctors and admins can write them; receptionists can read them; the
  assistant can only read them back, never write.
- A doctor's prescription is always recorded in their own name.
- **Changing (docs/02, 2026-10-12):** today the record is sent on WhatsApp
  exactly as stored. WhatsApp's Business Messaging Policy forbids sending
  health information in chat, so this is being replaced: the patient gets a
  "your prescription from Dr. Rao is ready" notice (an approved template,
  naming no drug or dose) with a secure, OTP-gated link to the record. Until
  then, prescribe-and-send is not used with real patients.
- What the patient sees is always exactly what was stored — drug, dosage,
  duration, notes, who prescribed it, and the clinic's number. It states; it
  never advises.
- The doctor is told on screen exactly what reached the patient.

### Who can do what

| Role | Patients | Appointments | Prescriptions | Escalation inbox |
|---|---|---|---|---|
| Assistant (automated) | Limited fields | Read, and write through its booking tools only | Read only | Can create, cannot resolve |
| Receptionist | All in the clinic | Read and write | Read only | Yes |
| Doctor | Own patients only | Whole clinic read-only, own write | Read and write | No — can raise one, not work the queue |
| Admin | All | All | All | Yes |

---

## Part 3 — Reminders

| Reminder | When | Status |
|---|---|---|
| Appointment reminder | Before the visit | Available — needs Meta template approval |
| Prescription record notice | When a doctor saves a prescription outside the 24-hour window | Available — needs Meta template approval |
| Refill / follow-up | When a prescribed course is ending | Built, switched off until the clinic picks the lead time |

- Each reminder re-checks, at the moment of sending, that the appointment is
  still booked or the prescription still active — a cancelled appointment or
  a discontinued drug never gets a stale reminder.
- Failed sends are retried; if they keep failing, the clinic team is alerted.
  A missed medication reminder is treated as a real harm, not a glitch.
- Template wording names no clinical advice (docs/10).

---

## Part 4 — Privacy, security and trust

- **Built around India's DPDP Act** — recorded, versioned, revocable consent;
  only the data needed is collected; a patient-initiated deletion path; and an
  automatic purge after the retention period (docs/02). Legal review of the
  consent text and retention period is still required before launch.
- **Audit trail** — every view or change of patient and prescription data,
  every booking and every escalation is logged with who did it and when.
- **No double bookings, ever** — slot conflicts are blocked by the database
  itself, tested with a hundred simultaneous booking attempts.
- **Two locks on every risky action** — the application checks permissions,
  and the database independently refuses what the role is not allowed to do.
- **Clinic isolation** — every record belongs to one clinic, and staff can
  only ever reach their own clinic's data. Database-enforced isolation
  (row-level security) is planned on top.
- **Secure sign-in** — strong password hashing and lockout after repeated
  failed attempts.
- **Official WhatsApp only** — the Meta WhatsApp Business Platform (Cloud
  API), with every incoming message cryptographically verified as coming from
  Meta.
- **Hosting** — Postgres in the Asia-Pacific (Singapore) region, encrypted in
  transit and at rest. India-region hosting is preferred and planned.
- **Minimal AI exposure** — the AI (Mode A only) sees only booking-relevant
  text, never medical history or prescriptions. Mode B uses no AI at all.

---

## Part 5 — For each clinic

- **Its own WhatsApp number**, under its own name — patients never see another
  clinic or a shared number.
- **Its own data**, separate from every other clinic's.
- **Its own staff accounts** with the roles above.
- **Its own doctors**, with their own slot lengths. Clinic hours are currently
  one shared schedule (9:00–18:00, Monday–Saturday); per-clinic and per-doctor
  hours are planned.
- **Self-service onboarding** ("Connect WhatsApp" through Meta's Embedded
  Signup) is planned once the company is an approved Meta Tech Provider. Until
  then, each clinic is set up with the team directly.

---

## What Doctor-CRM deliberately does not do

- Diagnose, triage, or suggest treatment
- Answer medication, dosage, side-effect or interaction questions
- Interpret lab reports
- Handle insurance or billing
- Take voice calls (planned only after WhatsApp is proven)
- Collect medical history forms or any data not needed for booking,
  reminders, or the doctor's own record
