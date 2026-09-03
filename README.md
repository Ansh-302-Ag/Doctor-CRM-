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
2. Create a second database on the same Postgres for the test suite (the suite
   truncates every table it touches, so it must not share with development) and
   point `TEST_DATABASE_URL` at it. On Neon: **Databases → New database**,
   name it `neondb_test`.

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

## Tests

```bash
npm test          # 58 tests against TEST_DATABASE_URL
npm run typecheck
```

Run `npm run migrate` against the test database once before the first `npm test`:

```bash
npx tsx scripts/migrate.ts "<your TEST_DATABASE_URL>"
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

`docs/09-implementation-log.md` records what is built, what was decided while
building it, and what is deliberately left for later.
