#!/usr/bin/env bash
# Runs SQL against the run's local D1 and records the query and its rows as <run>/evidence/<NN>-<label>.sql.txt.
# Read-only use is for proof (side effects); writes are for seeding preconditions a journey needs, never for the
# action under test.
# Usage: sql.sh <run-dir> <label> "<SQL>"
set -euo pipefail
run=${1:?run dir} label=${2:?label} query=${3:?SQL}
# shellcheck disable=SC1091
source "$run/run.env"
last=$(find "$RUN/evidence" -maxdepth 1 -type f -exec basename {} \; | sed -n 's/^0*\([0-9][0-9]*\)-.*/\1/p' | sort -n | tail -1)
n=$(printf '%02d' $((${last:-0} + 1)))
out=$RUN/evidence/$n-$label.sql.txt
raw=$(cd "$WORKER" && node_modules/.bin/wrangler d1 execute DB --local --persist-to "$STATE/wrangler" --json --command "$query" 2>&1) ||
  { echo "$raw" >&2; exit 1; }
rows=$(printf '%s' "$raw" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);if(!Array.isArray(v)){console.error(s);process.exit(1)}console.log(JSON.stringify(v.flatMap(r=>r.results),null,1))})')
{ echo "> $query"; echo "> at $(date -u +%FT%TZ)"; echo; echo "$rows"; } >"$out"
echo "($out)" >&2
echo "$rows"
