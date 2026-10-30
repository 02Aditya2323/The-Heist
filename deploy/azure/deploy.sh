#!/usr/bin/env bash
# Install or update the already-synced checkout at /srv/the-heist and restart
# the service. Run ON the VM, after the source has been placed there.
#
# Used both by an administrator over SSH and by the GitHub Actions deploy job,
# so there is exactly one deployment path to reason about.
#
# Safety: the previous build is retained and restored if the new one fails its
# health check, so a bad revision cannot leave the event without a server.
set -euo pipefail

APP=/srv/the-heist
ENV_FILE=/etc/heist/heist.env
HEALTH=http://127.0.0.1:8080/health
BACKUP=/var/lib/heist/previous-build

log(){ echo "::: $*"; }
fail(){ echo "!!! $*" >&2; exit 1; }

[ -d "$APP" ] || fail "$APP missing"
sudo test -f "$ENV_FILE" || fail "$ENV_FILE missing; install it before deploying"

cd "$APP"

# A checkout .env would shadow the private root-only environment file and is
# rejected by the preflight, so make sure a sync never left one behind.
[ -f .env ] && fail "a checkout .env exists at $APP/.env; remove it"

log "installing dependencies"
# `npm ci` is used rather than `npm install` so the lockfile is authoritative.
# Build scripts must run: argon2 and better-sqlite3 are native modules.
npm ci --no-audit --no-fund

# Clear previous compiler output before building.
#
# Incremental TypeScript state is the hazard here. A `tsconfig.tsbuildinfo`
# produced on another machine makes tsc believe the outputs are current, so it
# emits nothing and the build "succeeds" with missing or half-written type
# declarations. A partially transferred `dist` has the same effect. Both have
# bitten this deployment, so the build always starts from a known-empty state;
# a full build of this workspace costs well under a minute on the VM.
log "clearing stale build output"
find packages apps -maxdepth 2 -name dist -type d -prune -exec rm -rf {} +
find packages apps -maxdepth 2 -name '*.tsbuildinfo' -delete

log "building workspaces"
npm run build

log "preflight"
# check-vm-env.mjs validates the *process* environment, which is exactly right
# for systemd's ExecStartPre where the EnvironmentFile is already loaded. To get
# the same verdict early, source the file into this check's environment.
#
# `sudo VAR=...` would not work (sudo strips the environment) and passing values
# as arguments would expose the Atlas URI in the process list, so the file is
# sourced with auto-export inside the subshell and never reaches argv.
sudo bash -c '
  set -a
  . "$1"
  set +a
  cd "$2"
  exec node "$2/tools/check-vm-env.mjs"
' _ "$ENV_FILE" "$APP" || fail "preflight rejected this deployment"

log "installing systemd unit"
sudo install -o root -g root -m 0644 "$APP/deploy/azure/heist.service" /etc/systemd/system/heist.service
sudo systemctl daemon-reload
sudo systemctl enable heist >/dev/null

# Keep the proxy route allowlist in step with the code.
#
# This is not cosmetic. nginx-player.conf is deny-by-default, so a route added
# in the application but not in the snippet works perfectly on localhost and
# returns 404 in production. Redeploying the snippets alongside the build makes
# that class of mistake impossible.
#
# Only reloaded if the configuration tests clean, so a bad edit cannot take a
# running event offline. Skipped entirely when nginx is not installed, which is
# the case for a plain LAN host.
if command -v nginx >/dev/null 2>&1 && [ -d /etc/nginx/snippets ]; then
  log "syncing nginx route snippets"
  sudo install -o root -g root -m 0644 \
    "$APP/deploy/azure/nginx-player.conf" /etc/nginx/snippets/heist-player.conf
  if [ -f "$APP/deploy/azure/nginx-staff.conf" ] \
     && [ -f /etc/nginx/snippets/heist-staff.conf ]; then
    # Only refreshed when already installed: whether the organizer API is
    # exposed publicly is a deployment decision, and this must not enable it.
    sudo install -o root -g root -m 0644 \
      "$APP/deploy/azure/nginx-staff.conf" /etc/nginx/snippets/heist-staff.conf
  fi
  if sudo nginx -t >/dev/null 2>&1; then
    sudo systemctl reload nginx
    log "nginx reloaded"
  else
    echo "!!! nginx configuration test failed; left the running config alone" >&2
    sudo nginx -t || true
  fi
fi

log "restarting service"
sudo systemctl restart heist

log "waiting for health"
ok=0
for i in $(seq 1 40); do
  if curl --fail --silent --max-time 3 "$HEALTH" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done

if [ "$ok" != 1 ]; then
  echo "!!! health check failed after 80s; recent service log:" >&2
  sudo journalctl -u heist -n 40 --no-pager >&2 || true
  fail "deployment unhealthy"
fi

log "healthy: $(curl --silent --max-time 3 "$HEALTH")"
log "done"
