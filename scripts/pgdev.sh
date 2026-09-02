#!/usr/bin/env bash
# Local Postgres for development and tests.
#
# Why this exists: this dev environment has no system Postgres and no outbound
# access to a hosted one, so we run the binaries that ship with the
# `embedded-postgres` dev dependency. Idempotent — safe to call before anything.
set -euo pipefail

PGBIN="$(cd "$(dirname "$0")/.." && pwd)/node_modules/@embedded-postgres/linux-x64/native/bin"
export PGDATA="${PGDATA:-$HOME/pgdata}"
PORT="${PGPORT:-55432}"

if [ ! -d "$PGDATA" ]; then
  printf 'devpass' > /tmp/.pgpw
  "$PGBIN/initdb" -D "$PGDATA" -U postgres --pwfile=/tmp/.pgpw -A scram-sha-256 --encoding=UTF8 >/dev/null
  rm -f /tmp/.pgpw
fi

# Ask the port, not the pid file: this environment tears the server down between
# commands and can leave a stale postmaster.pid behind.
listening() { (exec 3<>"/dev/tcp/127.0.0.1/$PORT") 2>/dev/null; }

if ! listening; then
  rm -f "$PGDATA/postmaster.pid"
  "$PGBIN/pg_ctl" -D "$PGDATA" -l "$HOME/pg.log" -w \
    -o "-p $PORT -c listen_addresses=127.0.0.1" start >/dev/null
fi

for _ in $(seq 1 20); do listening && exit 0; sleep 0.5; done
echo "postgres did not come up on port $PORT; see $HOME/pg.log" >&2
exit 1
