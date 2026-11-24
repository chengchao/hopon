#!/usr/bin/env bash
# Seeds what the Coder would have made for a Draft: Revision 1's page (Odd Duck's, borrowed from the run's R2) and a
# title. With a PNG, also the Revision's cover, which a build keeps from the agent's playtest: any portrait image does,
# 360x640 is the playtest's size. This is seeding for preview, the cover and publish, never the step under test.
# Records the page fetch and the title row.
# Usage: seed-revision.sh <run-dir> <draft-id> [title] [cover.png]
set -euo pipefail
run=${1:?run dir} id=${2:?draft id} title=${3:-Cat Run} cover=${4:-}
here=$(dirname "$0")
# shellcheck disable=SC1091
source "$run/run.env"
page=$STATE/revision-page.html
q="'"
"$here/call.sh" "$run" seed-revision-source GET /games/2/index.html >"$page"
(cd "$WORKER" && node_modules/.bin/wrangler r2 object put "hopon/drafts/$id/1/index.html" --local \
  --persist-to "$STATE/wrangler" --file "$page" >/dev/null)
covered=NULL
if [ -n "$cover" ]; then
  (cd "$WORKER" && node_modules/.bin/wrangler r2 object put "hopon/drafts/$id/1/cover.png" --local \
    --persist-to "$STATE/wrangler" --file "$cover" >/dev/null)
  covered=1
fi
"$here/sql.sh" "$run" seed-revision-title \
  "UPDATE drafts SET title='${title//$q/$q$q}', cover_revision=$covered WHERE id='$id' RETURNING id, title, cover_revision" >/dev/null
echo "Draft $id has Revision 1 and title '$title'${cover:+ and a cover}"
