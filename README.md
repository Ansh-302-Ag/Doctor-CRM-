# AI Receptionist + Clinic CRM

An AI agent that handles a clinic's WhatsApp front desk — booking,
rescheduling, cancelling, reminders — plus the CRM where staff see the
calendar and answer anything the agent refused to.

**The agent manages logistics. The doctor makes every clinical decision.**
That boundary is enforced in three places, not one: the safety screen, the
tool set (there is no tool that can answer a clinical question), and the
agent's own Postgres grants. See `docs/01` and `docs/08`.

## Getting started

```bash
npm install
```

Then, in `.env.local`:

1. Replace both `CHANGE-ME` values with one password of your choosing — that is
   the password for `clinic_agent`, the restricted role the agent connects as.
2. Leave `TEST_DATABASE_URL` commented out. `npm test` then starts its own
   throwaway Postgres locally and tears it down again — nothing to create, no
   network. Set it only if you want the suite to run against a real remote
   database, in which case make it a *separate* database from development: the
   suite truncates every table it touches.
3. For development, run Postgres beside the app rather than reaching across the
   internet for it:

   ```bash
   npm run db      # leave this terminal open
   ```

   It starts a Postgres on `127.0.0.1:55433`, creates the `clinic` and
   `clinic_test` databases, and keeps the data in `.pgdata/` between restarts.
   `.env.local` points at it out of the box. A remote database costs a round
   trip per query — measured at 279 ms to Neon's us-east-2 from India, and one
   inbound WhatsApp message makes about a dozen sequential queries, so that was
   three to four seconds of every reply.

   On Windows, run it from a **normal** terminal: Postgres refuses to start
   under administrator rights, by design. A `.pgdata` created on one operating
   system cannot be opened by another — delete it and re-run if you move
   machines; the script says so when it happens.

```bash
npm run migrate
npm run seed     # prints a CLINIC_ID — paste it into .env.local
npm run dev      # http://localhost:3000
```

Sign in with `desk@sunrise.clinic` / `password123` (development seed only).

If `npm run migrate` fails on `db/002_agent_role.sql` with a permission error,
your database user cannot create roles. Create `clinic_agent` from the provider
console, then re-run — the rest of that migration only grants privileges.

## Talking to the agent without a WhatsApp account

```bash
npm run sim -- +919000000001
```

A terminal chat against the real agent, real tools and real database —
everything except Meta. Try "I need an appointment with Dr. Rao", then
"tomorrow", then a time. Then try "can I take paracetamol with it" and watch
it escalate instead of answering.

## Talking to the agent from a real phone

The app talks to the WhatsApp Business Cloud API directly — no gateway, no
second process. From the Meta app dashboard (**WhatsApp → API Setup**, and
**App settings → Basic** for the secret), set in `.env.local`:

```
WHATSAPP_TOKEN=            # a System User token, not the 24-hour temporary one
WHATSAPP_PHONE_NUMBER_ID=  # the sending number's id, not the number itself
WHATSAPP_APP_SECRET=       # signs every inbound webhook; unset = every POST rejected
WHATSAPP_VERIFY_TOKEN=     # any random string; paste the same one into Meta
```

Meta must reach the webhook over public HTTPS. Locally, tunnel to the dev server:

```bash
npm run dev
npx cloudflared tunnel --url http://localhost:3000
```

In **WhatsApp → Configuration → Webhook**, set the callback URL to
`https://<tunnel-host>/api/webhook/whatsapp`, the verify token to
`WHATSAPP_VERIFY_TOKEN`, and subscribe to the **messages** field.

Caveats:

- **Free-form replies only inside 24 hours** of the patient's last message.
  Everything the clinic starts (reminders, the `record_updated` nudge) is a
  template and fails until Meta approves it — see
  `docs/10-whatsapp-templates.md`.
- **A test number only reaches numbers you have added** as recipients in API
  Setup (up to five).
- **The temporary token expires in 24 hours.** Sends then fail with 401.

## The agent

`src/lib/agent/screen.ts` is deterministic keyword matching and runs first. If
it says emergency or clinical, the message escalates and no model is called.

Everything after that is one Anthropic Messages API call
(`src/lib/agent/intent.ts`, Haiku tier, forced tool use) returning the intent,
the doctor, the day, and which offered slot the patient picked. Set
`ANTHROPIC_API_KEY` in `.env.local`. Without it — or if the API errors or times
out — every message escalates to a human. There is no fallback parser, on
purpose: quietly degrading to worse parsing is how you book the wrong slot.

The model is sent the message, the clinic's doctor names, the times just
offered, and today's date. Never appointment history, never prescriptions
(`docs/02`).

## Reminders

Reminders are clinic-initiated, and WhatsApp only allows that through a
template approved by Meta in advance. `docs/10-whatsapp-templates.md` has the
exact text to submit and tracks approval status. Until both templates are
approved, no reminder can reach a patient.

Nothing runs on a timer inside the app — it is serverless. Point a scheduler at
these two endpoints, both with `Authorization: Bearer $CRON_SECRET`:

| Endpoint | How often | What it does |
|---|---|---|
| `GET /api/cron/reminders` | every 15 minutes | sends reminders that have come due |
| `GET /api/cron/purge` | daily | destroys records past the retention window |

Both refuse to run if `CRON_SECRET` is unset — an unprotected reminder endpoint
would let anyone make the clinic message its patients, and an unprotected purge
endpoint would let anyone destroy records.

A reminder re-checks the world immediately before sending. A cancelled
appointment, a discontinued prescription, or a patient who withdrew consent all
result in no message, however the reminder was scheduled. A send that fails is
retried with backoff, and after three attempts it raises an escalation so a
human is told rather than the reminder disappearing.

## Tests

```bash
npm test                         # local throwaway Postgres, started and stopped for you
npm test -- tests/booking.test.ts # one file
npm run test:neon                # against TEST_DATABASE_URL instead
npm run typecheck
```

`npm test` starts a disposable Postgres (data in the gitignored the system temp directory),
migrates it, runs the suite and shuts it down. A remote database costs a
round trip per query — from India that was ~280 ms, which made a full run take
minutes. Setting `TEST_DATABASE_URL` still wins and is what `test:neon` uses;
run that before trusting a release, since it is the only path that exercises
the real database.

The suite drives the agent with a scripted stand-in for the model, so it stays
offline and deterministic. `tests/intent.live.test.ts` hits the real API and is
skipped unless a key is present:

```bash
ANTHROPIC_API_KEY=sk-... npm test
```

If you point `TEST_DATABASE_URL` at your own database, migrate it once first:

```bash
npx tsx scripts/migrate.ts "<your TEST_DATABASE_URL>"
```

The local path migrates itself.

The suite is the docs/08 bar, not a smoke test: concurrent bookings of one
slot, the agent's role being refused a prescription write, a duplicate webhook
delivery, a clinical question mid-booking, consent not yet granted.

## Where things are

| Path | What |
|---|---|
| `docs/` | The design. `00-README.md` first; `09-implementation-log.md` for current state |
| `docs/runbooks/` | Operational runbooks — `breach.md` for a suspected DPDP breach |
| `docs/10-whatsapp-templates.md` | The WhatsApp template text used for reminders |
| `db/` | Numbered SQL migrations |
| `src/lib/` | Business logic — booking, consent, RBAC, audit |
| `src/lib/agent/` | The safety screen, the tool set, the conversation state machine |
| `src/app/` | CRM pages and the WhatsApp webhook |
| `scripts/` | Migrations, seed, simulator, local Postgres |
| `tests/` | The suite |

## Environment

`.env.example` lists every variable. Two worth calling out:

- `AGENT_DATABASE_URL` — the agent connects as the restricted `clinic_agent`
  role so its grants bind at runtime. Set it; without it the agent falls back
  to the application role and only the app-layer checks apply.
- `WHATSAPP_*` — unset means outbound messages are logged instead of sent,
  which is what makes the simulator work. Setting them switches to the real
  Cloud API with no code change.

`docs/09-implementation-log.md` records what is built, what was decided while
building it, and what is deliberately left for later.
