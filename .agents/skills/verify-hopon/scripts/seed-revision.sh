#!/usr/bin/env bash
# Seeds what the Coder would have made for a Draft: Revision 1's page (Odd Duck's, borrowed from the run's R2) and a
# title. This is seeding for preview and publish, never the step under test. Records the page fetch and the title row.
# Usage: seed-revision.sh <run-dir> <draft-id> [title]
set -euo pipefail
run=${1:?run dir} id=${2:?draft id} title=${3:-Cat Run}
here=$(dirname "$0")
# shellcheck disable=SC1091
source "$run/run.env"
page=$STATE/revision-page.html
q="'"
"$here/call.sh" "$run" seed-revision-source GET /games/2/index.html >"$page"
(cd "$WORKER" && node_modules/.bin/wrangler r2 object put "hopon/drafts/$id/1/index.html" --local \
  --persist-to "$STATE/wrangler" --file "$page" >/dev/null)
"$here/sql.sh" "$run" seed-revision-title \
  "UPDATE drafts SET title='${title//$q/$q$q}' WHERE id='$id' RETURNING id, title" >/dev/null
echo "Draft $id has Revision 1 and title '$title'"
