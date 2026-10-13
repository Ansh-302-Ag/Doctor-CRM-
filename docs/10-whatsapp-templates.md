# WhatsApp message templates

WhatsApp only allows free-form text within 24 hours of a patient's last
message. Anything the clinic initiates — an appointment reminder, a refill
follow-up — must instead use a message template pre-approved by Meta, sent
via `sendTemplate` (`src/lib/channel.ts`), never `sendMessage`.

The body text below is copied character-for-character from `bodyText` in
`src/lib/templates.ts`. Meta approves an exact string; if this document and
that file ever disagree, the template will fail to send. When the copy
changes, edit `templates.ts` first and copy the result here — never the
other way around.

## Submission checklist

- [ ] Create the WhatsApp Business template in Meta Business Manager
- [ ] Category: **Utility**
- [ ] Language: **English** (`en`)
- [ ] Body text: pasted verbatim from below, placeholders as `{{1}}`, `{{2}}`, ...
- [ ] Sample values supplied for every placeholder (below)
- [ ] Submit for review
- [ ] Record the approval status in the table below
- [ ] Confirm the approved template name in Meta matches the `TemplateName`
      used here (`appointment_reminder`, `record_updated`, `refill_followup`, `staff_alert`)

## `appointment_reminder`

Body text:

```
Reminder from {{1}}: you have an appointment with {{2}} on {{3}}. Reply CANCEL if you can no longer make it.
```

Sample values for submission:

| Placeholder | Param name | Sample |
|---|---|---|
| `{{1}}` | `clinic_name` | Sunrise Clinic |
| `{{2}}` | `doctor_name` | Dr. Rao |
| `{{3}}` | `appointment_time` | Fri 4 Sept, 10:00 am |

## `record_updated`

Sent when a doctor records a prescription and the patient is **outside** the
24-hour window, so the record itself cannot be sent (`src/lib/doctor.ts`). It
names no drug, no dosage and no instruction — only that there is something to
collect. The patient's reply reopens the window, and the assistant then reads
the record back verbatim.

Body text:

```
A note from {{1}}: {{2}} added a new entry to your record today. Reply to this message to have it read back to you, or call the clinic.
```

Sample values for submission:

| Placeholder | Param name | Sample |
|---|---|---|
| `{{1}}` | `clinic_name` | Sunrise Clinic |
| `{{2}}` | `doctor_name` | Dr. Rao |

## `refill_followup`

Body text:

```
A note from {{1}}: the course of {{2}} on your record is ending. Reply BOOK to arrange a follow-up, or call the clinic.
```

Sample values for submission:

| Placeholder | Param name | Sample |
|---|---|---|
| `{{1}}` | `clinic_name` | Sunrise Clinic |
| `{{2}}` | `drug_name` | Amoxicillin |

## `staff_alert`

Pages the on-duty staff phone when a conversation escalates. That phone is
outside the 24-hour window unless it messaged the business number today, so
free-form text would be silently dropped. It carries no patient detail.
`priority` is the string `urgent` or `routine`.

Body text:

```
Clinic alert for {{1}}: a patient conversation needs a person ({{2}}). Please open the escalation inbox in the clinic dashboard.
```

Sample values for submission:

| Placeholder | Param name | Sample |
|---|---|---|
| `{{1}}` | `clinic_name` | Sunrise Clinic |
| `{{2}}` | `priority` | urgent |

## Status

| Template | Submitted | Approved | Notes |
|---|---|---|---|
| `appointment_reminder` | No | No | Not yet submitted to Meta. |
| `record_updated` | No | No | Not yet submitted to Meta. Needed before a prescription recorded outside the window can nudge the patient at all. |
| `refill_followup` | No | No | Not yet submitted to Meta. |
| `staff_alert` | No | No | Not yet submitted to Meta. Until approved, paging falls back to free-form text, which only reaches a phone that messaged the number in the last 24 hours. |

## Why the copy reads the way it does

Neither template advises, instructs, or implies a clinical decision — it
states that a logistics event (an appointment, a prescription ending) is
approaching, and nothing more. `docs/01` forbids the AI from making or
implying clinical decisions, and `tests/templates.test.ts` enforces the
same rule mechanically: it asserts that no template body matches clinical
vocabulary (`dose`, `dosage`, `take`, `should`, `symptom`, `treat`, `cure`,
`diagnos*`, `safe`, `healthy`). Any future template copy must clear that
same test before it can be submitted to Meta.
