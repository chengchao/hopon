#!/usr/bin/env bash
# Starts one isolated hopon API for verification: its own port, its own D1/R2 state, its own Clerk key pair and
# Operator password, offline (no Workers AI). Prints the run dir as `RUN=<dir>` once the feed serves a playable game.
# Usage: .agents/skills/verify-hopon/scripts/launch.sh        (PORT=<n> to start the free-port search elsewhere)
set -euo pipefail
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
worker=$root/apps/worker
[ -d "$root/node_modules" ] || pnpm -C "$root" install --frozen-lockfile

run=$root/.verify/$(date +%Y%m%d-%H%M%S)-$$
mkdir -p "$run/state" "$run/evidence"
state=$run/state

port=${PORT:-8790}
while lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; do port=$((port + 1)); done

# The Worker verifies Clerk session JWTs offline against CLERK_JWT_KEY. This run's key pair stands in for the Clerk
# instance's, so token.mjs can sign tokens the real verifyToken accepts.
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$state/jwt.key" 2>/dev/null
openssl pkey -in "$state/jwt.key" -pubout -out "$state/jwt.pub"
operator=$(openssl rand -hex 24)
{
  printf 'CLERK_JWT_KEY="%s"\n' "$(cat "$state/jwt.pub")"
  printf 'OPERATOR_PASSWORD=%s\n' "$operator"
  printf 'PREVIEW_SECRET=%s\n' "$(openssl rand -hex 32)"
} >"$state/vars.env"

wr() { (cd "$worker" && pnpm exec wrangler "$@"); }
CI=1 wr d1 migrations apply DB --local --persist-to "$state/wrangler" >"$state/migrate.log" 2>&1 ||
  { cat "$state/migrate.log" >&2; exit 1; }
(cd "$worker" && node scripts/games-to-r2.mjs --persist-to "$state/wrangler") >"$state/seed.log" 2>&1 ||
  { cat "$state/seed.log" >&2; exit 1; }

# Own process group (set -m), so cleanup.sh kills wrangler, workerd and nothing else. The wrangler bin, not
# `pnpm exec`: pnpm starts its child in another process group, which the group kill would miss.
set -m
(cd "$worker" && exec node_modules/.bin/wrangler dev --local --ip 127.0.0.1 --port "$port" \
  --persist-to "$state/wrangler" --env-file "$state/vars.env" \
  --var HOPON_OFFLINE:1 --var OPERATOR_WEBHOOK_URL: --var CLERK_SECRET_KEY: --var CLOUDFLARE_API_KEY: \
  </dev/null >"$state/api.log" 2>&1) &
pgid=$!
set +m

cat >"$run/run.env" <<EOF
RUN=$run
STATE=$state
PORT=$port
ORIGIN=http://127.0.0.1:$port
PGID=$pgid
OPERATOR_PASSWORD=$operator
WORKER=$worker
EOF

# Ready = the feed lists a game and that game's page is served from R2, not just a listening port.
for _ in $(seq 120); do
  sleep 1
  kill -0 "$pgid" 2>/dev/null || { echo "wrangler exited; see $state/api.log" >&2; tail -20 "$state/api.log" >&2; exit 1; }
  first=$(curl -sf "http://127.0.0.1:$port/api/games" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).games[0]?.id??"")}catch{}})' || true)
  if [ -n "$first" ] && curl -sf -o /dev/null "http://127.0.0.1:$port/games/$first/index.html"; then
    echo "Ready on http://127.0.0.1:$port (log $state/api.log)"
    echo "RUN=$run"
    exit 0
  fi
done
echo "Not ready after 120s; see $state/api.log. Run cleanup.sh $run." >&2
exit 1
