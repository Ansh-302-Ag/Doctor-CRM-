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
cp .env.example .env.local     # then fill in DATABASE_URL and SESSION_SECRET
npm run migrate
npm run seed                   # prints the CLINIC_ID to add to .env.local
npm run dev                    # http://localhost:3000
```

Sign in with `desk@sunrise.clinic` / `password123` (development seed only).

## Talking to the agent without a WhatsApp account

```bash
npm run sim -- +919000000001
```

A terminal chat against the real agent, real tools and real database —
everything except Meta. Try "I need an appointment with Dr. Rao", then
"tomorrow", then a time. Then try "can I take paracetamol with it" and watch
it escalate instead of answering.

## Tests

```bash
npm test          # 58 tests against a real Postgres
npm run typecheck
```

The suite is the docs/08 bar, not a smoke test: concurrent bookings of one
slot, the agent's role being refused a prescription write, a duplicate webhook
delivery, a clinical question mid-booking, consent not yet granted.

## Where things are

| Path | What |
|---|---|
| `docs/` | The design. `00-README.md` first; `09-implementation-log.md` for current state |
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

`docs/09-implementation-log.md` covers the quirks of the machine this was
built on, including why development runs against a local Postgres.
