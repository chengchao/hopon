# Report and Operator

A user reports a game or comment for one of four reasons (age, hate, spam, other) from its "…" menu. The report is stored with a snapshot of the content and lands in the Operator's queue at `/operator`, a script-free page behind a password. There the Operator can Dismiss the report, Delete the content (closing its reports), or Ban the poster.

## Sub-features

- `report-game` / `report-comment` files a report; reporting again changes nothing and still succeeds.
- `report-own` refuses reporting your own game.
- `operator-auth` keeps `/operator` closed without the password.
- `operator-queue` lists open reports grouped by target, oldest first, with reason counts.
- `operator-dismiss` closes the reports and keeps the content.
- `operator-delete` confirms, then deletes the content and closes its reports as `deleted`.
- `operator-ban` (not drivable offline) bans the poster through Clerk and deletes their content.

## How to get to it (user POV)

- A game's or comment's "…" → Report → a reason: `apps/mobile/components/report-sheet.tsx` → `POST /api/games/<id>/report` or `POST /api/comments/<id>/report` with `{"reason":"age"|"hate"|"spam"|"other"}`.
- The Operator opens `/operator` in a browser, using any username and `OPERATOR_PASSWORD`. Each target has Dismiss (`POST /operator/<kind>/<id>/dismiss`) and Delete and Ban links (`GET /operator/<kind>/<id>/delete|ban`, a confirm page whose form `POST`s the same path).

## Driving it with call.sh

Preconditions:

- Baseline run, doctor healthy. Bob has posted a comment on game 2 (see [comments.md](./comments.md)), which gives a comment `<cid>`.

- **Report.** Alice reports Bob's comment as spam. Run `$S/call.sh "$RUN" report POST /api/comments/<cid>/report --as user_alice:alice --json '{"reason":"spam"}'`. 204.
- **Stored.** Run `$S/sql.sh "$RUN" reports "SELECT id,comment_id,game_id,reason,reporter,status,body FROM reports"`. One `open` row: `reporter user_alice`, `body` the comment's text.
- **Own game.** Run `$S/call.sh "$RUN" report-own POST /api/games/2/report --as hopon --json '{"reason":"other"}'`. 400 "You can't report your own game."
- **Locked out.** Run `$S/call.sh "$RUN" operator-noauth GET /operator`. 401 with `WWW-Authenticate: Basic realm="hopon Operator"`.
- **Queue.** Run `$S/call.sh "$RUN" operator-queue GET /operator --operator`. 200 HTML, with the comment's text, its reason count, and `<form method="post" action="/operator/comments/<cid>/dismiss">`.
- **Delete, confirm.** Open Delete. Run `$S/call.sh "$RUN" operator-delete-confirm GET /operator/comments/<cid>/delete --operator`. 200, a confirm page naming `@bob`.
- **Delete.** Confirm it. Run `$S/call.sh "$RUN" operator-delete POST /operator/comments/<cid>/delete --operator`. 303 to `/operator`. `$S/sql.sh` shows the report `closed` with `closed_how deleted`, and no `comments` row with that id. The queue no longer lists it.
- **Dismiss.** Report something else (game 2, `--as user_alice:alice`), then run `$S/call.sh "$RUN" operator-dismiss POST /operator/games/2/dismiss --operator`. 303; the report is `closed` as dismissed, and game 2 is still in the feed.

## Gotchas

- Without `--operator`'s `Sec-Fetch-Site: same-origin`, an Operator POST is refused by `csrf()` (403). That's the protection working, not a broken route.
- `GET /operator/<kind>/<id>/delete|ban` is a 404 "Report not found." unless the target has an open report.
- Ban calls Clerk's Backend API, and this run has no `CLERK_SECRET_KEY`, so Ban fails: 502 `{"error":"Couldn't ban this account just now. Please try again."}` (the confirm page `GET …/ban` still works and names the poster). Report Ban as unverified. Proving it needs `run-ios`'s Clerk setup and the human's agreement.
- No webhook fires: `OPERATOR_WEBHOOK_URL` is forced empty. The report is still stored, which is the behavior to prove.
- A reporter no longer sees what they reported, even after an unblock (`visibleTo`). Check the reporter's feed after reporting a game.
