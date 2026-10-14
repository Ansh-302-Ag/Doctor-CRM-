#!/usr/bin/env bash
# Deploy one commit to the server's app directory.
#
#   APP_DIR=/srv/doctor-crm RESTART_CMD="sudo systemctl restart doctor-crm" \
#     bash scripts/deploy.sh <commit-sha>
#
# Called by the deploy-dev job in .github/workflows/ci.yml on the self-hosted
# runner; runnable by hand for the same result. The app directory is its own git
# clone and keeps .env.local, which never comes from git.
#
# On a failed health check the code is put back to the previous commit, rebuilt
# and restarted. Migrations are forward-only and are NOT undone — every db/*.sql
# file is written to be safe for the previous code to run against.
set -euo pipefail

SHA="${1:?usage: deploy.sh <commit-sha>}"
: "${APP_DIR:?APP_DIR is not set (repository variable)}"
: "${RESTART_CMD:?RESTART_CMD is not set (repository variable)}"
PORT="${APP_PORT:-3000}"
[ -n "$PORT" ] || PORT=3000

cd "$APP_DIR"
[ -f .env.local ] || { echo "deploy: $APP_DIR/.env.local is missing" >&2; exit 1; }

PREVIOUS="$(git rev-parse HEAD)"
echo "deploy: $PREVIOUS -> $SHA"

build_and_restart() {
  git checkout --force --detach "$1"
  npm ci
  npm run build
  eval "$RESTART_CMD"
}

healthy() {
  # /login renders without a session; 200 means the app is up and its
  # database-backed layout did not throw.
  for _ in $(seq 1 30); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/login")" = "200" ]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

git fetch --quiet origin
git cat-file -e "$SHA^{commit}"

git checkout --force --detach "$SHA"
npm ci
npx tsx --env-file=.env.local scripts/migrate.ts
npm run build
eval "$RESTART_CMD"

if healthy; then
  echo "deploy: $SHA is live"
  exit 0
fi

echo "deploy: $SHA failed its health check; rolling back to $PREVIOUS" >&2
build_and_restart "$PREVIOUS"
if healthy; then
  echo "deploy: rolled back to $PREVIOUS" >&2
else
  echo "deploy: rollback to $PREVIOUS is ALSO unhealthy — needs a person" >&2
fi
exit 1
