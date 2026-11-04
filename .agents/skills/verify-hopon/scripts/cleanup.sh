#!/usr/bin/env bash
# Stops what launch.sh started (its process group only) and deletes the run's state. Keeps <run>/evidence.
# Usage: cleanup.sh <run-dir>      or      cleanup.sh --all   (every run under this checkout's .verify/)
set -uo pipefail
root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
if [ "${1:-}" = --all ]; then
  for env in "$root"/.verify/*/run.env; do [ -f "$env" ] && "$0" "$(dirname "$env")"; done
  exit 0
fi
run=${1:?run dir or --all}
[ -f "$run/run.env" ] || { echo "no $run/run.env" >&2; exit 1; }
# shellcheck disable=SC1091
source "$run/run.env"
if kill -0 "$PGID" 2>/dev/null; then
  kill -TERM -- "-$PGID" 2>/dev/null
  for _ in $(seq 20); do kill -0 "$PGID" 2>/dev/null || break; sleep 0.5; done
  kill -KILL -- "-$PGID" 2>/dev/null || true
fi
# Only a listener in our group counts as ours; anything else on the port is left alone and reported.
for p in $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null); do
  if [ "$(ps -o pgid= -p "$p" | tr -d ' ')" = "$PGID" ]; then kill -KILL "$p"; else
    echo "port $PORT is now held by pid $p, not this run; left alone" >&2
  fi
done
rm -rf "$STATE"
rm -f "$run/run.env"
echo "stopped run $(basename "$run"); evidence kept at $run/evidence ($(find "$run/evidence" -type f | wc -l | tr -d ' ') files)"
