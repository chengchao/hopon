#!/usr/bin/env bash
# Runs SQL against the run's local D1 and records the query and its rows as <run>/evidence/<NN>-<label>.sql.txt.
# Read-only use is for proof (side effects); writes are for seeding preconditions a journey needs, never for the
# action under test.
# Usage: sql.sh <run-dir> <label> "<SQL>"
set -euo pipefail
run=${1:?run dir} label=${2:?label} query=${3:?SQL}
# shellcheck disable=SC1091
source "$run/run.env"
n=$(printf '%02d' $(($(find "$RUN/evidence" -maxdepth 1 -type f | wc -l) + 1)))
out=$RUN/evidence/$n-$label.sql.txt
rows=$(cd "$WORKER" && pnpm exec wrangler d1 execute DB --local --persist-to "$STATE/wrangler" --json --command "$query" 2>/dev/null |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s).flatMap(r=>r.results),null,1)))')
{ echo "> $query"; echo "> at $(date -u +%FT%TZ)"; echo; echo "$rows"; } >"$out"
echo "($out)" >&2
echo "$rows"
