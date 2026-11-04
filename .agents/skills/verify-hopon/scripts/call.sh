#!/usr/bin/env bash
# One HTTP request to the run's API, recorded as evidence: the request and the full response (status, headers, body)
# go to <run>/evidence/<NN>-<label>.http, and the response body is printed. Exit status is curl's (0 on any HTTP status).
# Usage: call.sh <run-dir> <label> <METHOD> <path> [--as <user_id>[:<handle>]] [--json '<body>'] [--operator] [--form '<a=b>']
#   --as        signs in as that account (token.mjs); add :<handle> for an account with a Handle
#   --operator  sends the Operator's Basic credentials and the same-origin header the page's own posts carry
set -euo pipefail
run=${1:?run dir} label=${2:?label} method=${3:?method} path=${4:?path}
shift 4
# shellcheck disable=SC1091
source "$run/run.env"
here=$(dirname "$0")
args=(-sS -i --compressed -X "$method")
shown=()
while [ $# -gt 0 ]; do
  case $1 in
    --as)
      user=${2%%:*}
      handle=$([ "$2" != "${2#*:}" ] && echo "${2#*:}" || true)
      args+=(-H "Authorization: Bearer $(node "$here/token.mjs" "$run" "$user" ${handle:+"$handle"})")
      shown+=("as $2")
      shift 2 ;;
    --json) args+=(-H "Content-Type: application/json" --data "$2"); shown+=("json $2"); shift 2 ;;
    --form) args+=(--data "$2"); shown+=("form $2"); shift 2 ;;
    --operator) args+=(-u "operator:$OPERATOR_PASSWORD" -H "Sec-Fetch-Site: same-origin"); shown+=(operator); shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
last=$(find "$RUN/evidence" -maxdepth 1 -type f -exec basename {} \; | sed -n 's/^0*\([0-9][0-9]*\)-.*/\1/p' | sort -n | tail -1)
n=$(printf '%02d' $((${last:-0} + 1)))
out=$RUN/evidence/$n-$label.http
response=$(curl "${args[@]}" "$ORIGIN$path")
{
  echo "> $method $path ${shown[*]:-}"
  echo "> at $(date -u +%FT%TZ)"
  echo
  printf '%s\n' "$response" | tr -d '\r'
} >"$out"
status=$(printf '%s\n' "$response" | head -1 | tr -d '\r')
echo "$status  ($out)" >&2
printf '%s\n' "$response" | tr -d '\r' | sed '1,/^$/d'
