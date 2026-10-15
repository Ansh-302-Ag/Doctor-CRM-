# Dev server runbook

The always-on development deployment of Doctor-CRM. Not production: no real
clinic, the Meta **test** number, the Neon **dev** database. Set up
2026-10-14; see `docs/09-implementation-log.md` for how it was built and why.

## Where it is

| Thing | Value |
|---|---|
| Public URL | https://clinic.concilio.solutions |
| Host | the shared Concilio server (Ubuntu 26.04, behind NAT, egress via Cloudflare WARP). It also runs Concilio, Coolify and local LLMs — leave those alone |
| App user | `doctorcrm` (system user, no login shell, home `/srv/doctor-crm`, linger on) |
| App checkout (`APP_DIR`) | `/srv/doctor-crm/app` — a git clone on `main`, read-only deploy key |
| Secrets | `/srv/doctor-crm/app/.env.local` (600 doctorcrm). Never in git |
| App service | systemd **user** unit `doctor-crm.service` → `npm start -- -H 127.0.0.1`, port 3000 |
| Timers | `doctor-crm-reminders.timer` (every 15 min), `doctor-crm-purge.timer` (21:30 UTC = 03:00 IST); both run `/srv/doctor-crm/bin/cron-call.sh <job>` against `http://127.0.0.1:3000/api/cron/*` |
| GitHub runner | `/srv/doctor-crm/actions-runner`, name `concilio-doctor-crm-dev`, label `doctor-crm-dev`, system service `actions.runner.Ansh-302-Ag-Doctor-CRM-.concilio-doctor-crm-dev` |
| Tunnel | system service `cloudflared-doctor-crm` (token in `/etc/cloudflared/doctor-crm.env`, 600 root), drop-in `10-ipv4-edge.conf` sets `TUNNEL_EDGE_IP_VERSION=4` |
| Cloudflare | Tunnel `doctor-crm-dev` → `http://127.0.0.1:3000`; DNS: one proxied CNAME `clinic` → `<id>.cfargotunnel.com`. Access apps: **Doctor-CRM dev** (whole host, Allow, email one-time PIN) and **Doctor-CRM webhook** (path `api/webhook/whatsapp`, **Bypass**, Everyone) |
| Meta | webhook callback `https://clinic.concilio.solutions/api/webhook/whatsapp`, field `messages` subscribed |
| Voice agent | Sarvam, Krishna's Workspace, agent **Reciptionsist** (`Reciptionsi-8a339a38-98e7`), deployment **TEST CRM** on +91 79654 80810. Tools `load_clinic_context` (on start), `check_availability`, `book_appointment` → `/api/voice/*`, bearer secret `doctor-crm-voice` = `VOICE_API_SECRET` in `.env.local`. Access app **Doctor-CRM voice** (path `api/voice`, **Bypass**) |
| Database | Neon project `super-truth-39272047` (Singapore), database `neondb`; tests use `neondb_test` |

## How code gets here

A green push to `main` deploys automatically: `.github/workflows/ci.yml` runs
the tests on GitHub, then the `deploy-dev` job runs on the runner above and
calls `scripts/deploy.sh <sha>` — fetch, checkout, `npm ci`, migrations,
build, restart, health check on `127.0.0.1:3000/login`, code rollback if
unhealthy. Repo variables: `APP_DIR=/srv/doctor-crm/app`,
`RESTART_CMD=systemctl --user restart doctor-crm.service`.

**Do not hand-edit files in `/srv/doctor-crm/app`.** The next deploy
force-checks-out `main` and silently reverts them. A hotfix must land in `main`.

## Everyday commands (run on the server; anything with `sudo` needs Ansh)

```bash
# app status / restart / logs
sudo systemctl --user -M doctorcrm@ status doctor-crm.service --no-pager
sudo systemctl --user -M doctorcrm@ restart doctor-crm.service
sudo journalctl _UID=$(id -u doctorcrm) -n 100 --no-pager      # app + timers (adm group can read without sudo)

# timers
sudo systemctl --user -M doctorcrm@ list-timers
sudo journalctl _SYSTEMD_USER_UNIT=doctor-crm-cron@reminders.service -n 5 --no-pager

# tunnel
sudo systemctl status cloudflared-doctor-crm --no-pager
sudo journalctl -u cloudflared-doctor-crm -n 30 --no-pager | grep -iv token

# runner
sudo systemctl status 'actions.runner.*doctor-crm-dev*' --no-pager

# what is deployed
sudo -u doctorcrm git -C /srv/doctor-crm/app log -1 --oneline

# edit secrets, then restart the app
sudo -u doctorcrm nano /srv/doctor-crm/app/.env.local
```

Health from anywhere: `/login` must 302 to `conciliosolutions.cloudflareaccess.com`;
`GET /api/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=1`
must return **403** (the app), not 302; an unsigned POST there returns **401**.

## Rules on this server

- The server's own Claude agent runs as `concilio_server` and **has no sudo**
  (server policy: no NOPASSWD). Every privileged step is run by Ansh.
- **No reboots without Ansh's say-so** — the box also serves Concilio. A
  kernel update is pending; reboot only in a window Ansh picks.
- Secrets never go on a command line (`sudo` logs argv to the journal): read
  them with `read -rs` inside the shell that uses them, or pass on stdin.
- Never run the test suite against `neondb`.

## Known behaviours, not faults

- cloudflared registers 3 connections (bom06 ×2, del05), not 4: the fourth slot
  logs "already connected to this server, trying another address". Harmless.
- IPv6 edges are unreachable through WARP — hence the IPv4-only drop-in. QUIC
  over IPv4 works; do not force `http2` (the second region blocks it).
- A deploy run created **before** a repository variable existed sees it empty
  (`APP_DIR is not set`). Re-run creates fresh context and works.
- `next start` logs nothing for successful requests; only errors appear in the
  journal (the agent logs `[agent] …` lines for classifier and booking failures).
- During a deploy, localhost may error for a few seconds before the restart.

## Still open

- Demo staff logins still use `password123` (decision 2026-10-14: keep for now;
  Cloudflare Access is the outer wall). Change before anyone outside the team uses it.
- `APP_URL=https://clinic.concilio.solutions` to be added to `.env.local` when
  the prescription-links work ships.
- Rollback proof (a deliberately broken commit on a throwaway branch) not yet run.
- Server on Wi-Fi; Ethernet planned. journald has no size cap (optional).
