# Breach runbook

This is the engineering runbook for a suspected or confirmed personal
data breach. It is not legal advice, and it does not replace counsel —
counsel is brought in at Step 3 below, every time, no exceptions.

## The threshold

Under the DPDP Act there is no minimum size for a notifiable breach.
Every unauthorised access, disclosure, alteration, or loss of personal
data is notifiable to the Data Protection Board and to affected users.
"It was only one record" is not a reason to skip this runbook. If
you're asking whether something is "big enough" to trigger this
process, it already has.

## What counts as a breach

Any of the following, and anything that rhymes with them:

- A leaked database credential (checked into a repo, pasted into a
  chat, found in a log).
- A staff account used by someone who isn't that staff member.
- A message sent to the wrong patient.
- A laptop or phone holding an exported patient list, lost or stolen.
- A misconfigured backup (public bucket, unencrypted export, wrong
  access grant).
- A vendor or provider (Neon, Meta, etc.) telling us they had an
  incident that affected our data.

If you're not sure whether something on this list happened, treat it
as if it did until you've confirmed otherwise. Escalate first, rule
out second.

## Step 0 — preserve evidence

Before anything else: do not delete or redeploy over anything yet.
You cannot investigate what you've already overwritten.

1. Snapshot the database (a Neon branch/snapshot, not just "we'll be
   fine, it's Neon").
2. Export the relevant `audit_log` rows. That table is append-only for
   exactly this reason — use it.

   ```sql
   select * from audit_log where created_at between :start and :end order by created_at;
   ```

Do this even if you're already sure what happened. You'll need the
export for Step 2 (assess) and Step 4 (postmortem), and it's much
harder to reconstruct after containment actions have started rotating
things.

## Step 1 — contain (first hour)

Act on whichever credential is implicated. If more than one might be,
do all of them — don't spend the first hour figuring out which one it
"really" was.

- **Database credential leaked** →
  `alter role clinic_agent password '<new>';`, update
  `AGENT_DB_PASSWORD` in the deploy environment, redeploy.
- **Staff account compromised** → delete the `staff_users` row.
  Sessions are 8-hour cookies and `currentStaff()` re-reads the account
  from the database on every request, so access ends on the staff
  member's next page load — no separate session-revocation step
  needed.
- **Session secret needs rotating, or you're not sure who else is
  compromised** → rotate `SESSION_SECRET`. This signs out every staff
  user in the system. Do it anyway — a forced re-login for everyone is
  cheap compared to a live intrusion.
- **`WHATSAPP_TOKEN` leaked** → revoke it in Meta Business Manager
  *first*, before doing anything else. A live token can send a message
  to every patient in the clinic; every minute it stays valid is a
  minute someone else could use it that way.

If the scope of the breach is unclear, take the app offline rather than
guess at a partial containment. A clinic can go back to booking on
paper for an afternoon. It cannot un-leak a patient record.

## Step 2 — assess (same day)

Write this down, in these terms, before moving to notification:

- **Which patients** — by id, pulled from the `audit_log` export, not
  a guess or a recollection of "probably just the ones from Tuesday."
- **Which fields** — phone numbers and appointment times are one
  severity; message bodies and prescription records are a different,
  higher one. Say which.
- **What window** — first and last timestamp the exposure covers.
- **Whether it is still happening** — if containment in Step 1 didn't
  fully stop it, say so explicitly; don't let "we rotated something"
  read as "we're safe now."

## Step 3 — notify

In this order:

1. **Counsel.** Before anyone else is told anything. They shape what
   Step 3's later notifications say.
2. **The Data Protection Board of India.** File what is known now and
   supplement as the picture completes — waiting for a complete
   picture before filing anything is not compliant and makes the
   window look worse, not better.
3. **Affected patients, directly.** Plain language, not a compliance
   template: what happened, what data, what we're doing about it, what
   they should do (change a password, watch for something specific)
   if anything.
4. **The clinic.** Last, but still the same day. They hold the
   relationship with the patient, not us, and they will be asked about
   this by their patients before we are — they should never hear about
   their own patients' breach from a patient instead of from us.

## Step 4 — afterwards

- Write a postmortem: timeline (built from the Step 0 audit export),
  root cause, what contained it, what didn't work.
- Every fix that comes out of the postmortem gets a regression test —
  a breach caused by a gap is not closed until there's a test that
  fails if the gap reopens.
- Update this runbook with whatever it failed to anticipate. A runbook
  that doesn't change after its first real use wasn't read carefully
  enough.

## Contacts

| Role | Name | Contact |
|---|---|---|
| Incident lead | *fill in before launch* | |
| Legal counsel | *fill in before launch* | |
| Clinic owner | *fill in before launch* | |
| Neon support | support@neon.tech / in-console chat | |
| Meta support | Meta Business Help Center (via Business Manager) | |

## Rehearsal

`docs/07` Phase 3 requires one tabletop exercise before launch, and it
has not happened yet. Run it against a concrete scenario, for example:

> A staff laptop with a patient export sitting in its downloads folder
> is stolen from a car.

Walk the whole runbook against that scenario — containment, what the
`audit_log` query actually returns for it, who you'd really call, what
the patient notification would really say — before this ever needs to
run for real. An untested runbook is a wish, not a plan.
