#!/usr/bin/env bash
# Read-only: is this run's API worth driving? Checks the process, that the port is ours, the build's config, seed data,
# that our signed tokens are accepted, and the Operator login. Prints one line per check; exits 1 on the first failure.
# Usage: doctor.sh <run-dir>
set -uo pipefail
run=${1:?run dir}
ok() { echo "ok   $*"; }
bad() { echo "FAIL $*"; exit 1; }
[ -f "$run/run.env" ] || bad "no $run/run.env: not a launch.sh run dir"
# shellcheck disable=SC1091
source "$run/run.env"
[ -d "$STATE" ] || bad "state dir gone: this run was cleaned up"
kill -0 "$PGID" 2>/dev/null && ok "process group $PGID alive" || bad "process group $PGID is gone; see $STATE/api.log"

listener=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1)
[ -n "$listener" ] || bad "nothing listens on $PORT"
[ "$(ps -o pgid= -p "$listener" | tr -d ' ')" = "$PGID" ] && ok "port $PORT held by our process group" ||
  bad "port $PORT is held by pid $listener, not this run's group $PGID"
lsof -a -p "$listener" -d cwd -Fn | grep -q "^n$WORKER" && ok "listener runs from $WORKER" ||
  bad "listener's cwd isn't $WORKER (another checkout?)"

want=$(grep -m1 '"MIN_IOS_BUILD"' "$WORKER/wrangler.jsonc" | grep -oE '[0-9]+')
got=$(curl -sf "$ORIGIN/api/version" | grep -oE '[0-9]+')
[ "$got" = "$want" ] && ok "/api/version minIosBuild $got matches wrangler.jsonc" || bad "/api/version says '$got', wrangler.jsonc says $want"

games=$(curl -sf "$ORIGIN/api/games" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const g=JSON.parse(s).games;console.log(g.length, g[0]?.id??"")})')
read -r count first <<<"$games"
[ "${count:-0}" -gt 0 ] && ok "feed lists $count games" || bad "feed is empty"
code=$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN/games/$first/index.html")
[ "$code" = 200 ] && ok "game $first's page served from R2" || bad "game $first's page is $code: R2 not seeded"

token=$(node "$(dirname "$0")/token.mjs" "$run" user_doctor)
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" "$ORIGIN/api/likes/count")
[ "$code" = 200 ] && ok "signed token accepted (/api/likes/count)" ||
  bad "signed token got $code: the Worker isn't using this run's CLERK_JWT_KEY"
code=$(curl -s -o /dev/null -w '%{http_code}' -u "operator:$OPERATOR_PASSWORD" "$ORIGIN/operator")
[ "$code" = 200 ] && ok "Operator login works" || bad "/operator with the run's password is $code"
echo "healthy: $ORIGIN"
