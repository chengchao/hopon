# Discover feed

Discover is the app's home tab: a vertical feed of published games, newest first, eight per page, each a playable page with its title, author, like and comment counts. Anyone can browse it signed out; signed in, each game also says whether you liked or saved it, or made it.

## Sub-features

- `feed-signed-out` lists published games with `liked`/`saved`/`mine` all false.
- `feed-signed-in` marks the viewer's own likes, saves and games.
- `feed-page` pages with `?before=<next>` until `next` is null.
- `feed-play` serves a listed game's page with the game CSP.
- `version-gate` tells builds older than `MIN_IOS_BUILD` to update.

## How to get to it (user POV)

- Open the app: the Discover tab, `apps/mobile/app/(tabs)/index.tsx` → `GET /api/games`.
- Swipe up past the eighth game: the next page, `?before=<next>`.
- A game on screen plays in a WebView from `GET /games/<id>/index.html` (`apps/mobile/components/feed.tsx`).
- App launch checks `GET /api/version` (`apps/mobile/app/_layout.tsx`).

## Driving it with call.sh

Preconditions:

- Baseline run, doctor healthy.

- **Signed out.** Open the feed without signing in. Run `$S/call.sh "$RUN" feed-signed-out GET /api/games`. 200, `games` ids `[3,2,1]`, each `liked:false, saved:false, mine:false, likes:0, comments:0`, `next:null`.
- **Signed in.** Open it as Alice. Run `$S/call.sh "$RUN" feed-alice GET /api/games --as user_alice:alice`. The same games. After Alice likes one (see [like-save.md](./like-save.md)), that game reads `liked:true`.
- **Paging.** Seed nine more games only if paging is the change under test (see Gotchas). Run `$S/call.sh "$RUN" feed-page2 GET "/api/games?before=<next>"`. The ids continue below `next`, with no repeats.
- **Play.** Load the first game's page. Run `$S/call.sh "$RUN" play-3 GET /games/3/index.html`. 200, `Content-Type: text/html`, the response has a `Content-Security-Policy` header, and the body is the Bubble Pop page (`<!doctype html>`).
- **Version gate.** Run `$S/call.sh "$RUN" version GET /api/version`. `{"minIosBuild":11}`, matching `MIN_IOS_BUILD` in `apps/worker/wrangler.jsonc`.

## Gotchas

- The seed has three games, so `next` is always null. Proving paging needs at least nine published games: `sql.sh` INSERT `games` rows (`owner, author, title, description, published=1`) as seeding, and report that the extra games were seeded.
- A seeded game has no page in R2 until you `wrangler r2 object put … --local --persist-to "$STATE/wrangler"` one, so `play` on it is a 404. Borrow an Original's page, as in `run-ios`'s "Other accounts' content".
- `/games/<id>/index.html` for a missing or unpublished game is a 404. It isn't a sign that seeding failed unless doctor also fails.
- What the WebView renders (the game actually running) is out of reach here. That's `run-ios`.
