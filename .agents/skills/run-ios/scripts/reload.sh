#!/usr/bin/env bash
# Quits Expo Go on the run's simulator (device.sh), reopens it on this Metro, and waits until the app's first feed
# request lands in the API log.
# Usage: [SIM_UDID=<udid>] reload.sh <api-log>
set -euo pipefail
log=${1:?usage: reload.sh <api-log>}
udid=$("$(dirname "$0")/device.sh")
echo "Simulator $udid"
before=$(grep -c "GET /api/games " "$log" || true)
xcrun simctl terminate "$udid" host.exp.Exponent 2>/dev/null || true
xcrun simctl openurl "$udid" exp://127.0.0.1:8081
for _ in $(seq 60); do
  sleep 1
  if [ "$(grep -c "GET /api/games " "$log" || true)" -gt "$before" ]; then
    echo "Loaded the current bundle."
    exit 0
  fi
done
echo "No new GET /api/games in $log after 60s: the app is still on an old bundle, or Metro isn't serving." >&2
exit 1
