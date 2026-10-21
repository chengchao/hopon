#!/usr/bin/env bash
# Prints the UDID of the one simulator a run drives: $SIM_UDID when set, otherwise the only booted one. Fails when
# several are booted, because `simctl … booted` then picks one of them, maybe another session's.
set -euo pipefail
if [ -n "${SIM_UDID:-}" ]; then
  echo "$SIM_UDID"
  exit 0
fi
booted=$(xcrun simctl list devices booted | grep -oE '[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}' || true)
case $(printf '%s' "$booted" | grep -c .) in
  1) echo "$booted" ;;
  0) echo "No simulator is booted." >&2; exit 1 ;;
  *)
    echo "Several simulators are booted. Set SIM_UDID to the one this run drives:" >&2
    xcrun simctl list devices booted | grep Booted >&2
    exit 1
    ;;
esac
