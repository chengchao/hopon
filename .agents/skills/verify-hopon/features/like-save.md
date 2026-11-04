# Like and save

On a game in the feed, a signed-in user taps the heart to like it (a public count) or the bookmark to save it (private, listed in the Saved tab). Tapping again undoes either. Me shows how many games you liked and saved. Signed out, either tap goes to Sign in.

## Sub-features

- `like-on` likes a game and gets back the new count.
- `like-off` unlikes it; the count drops.
- `like-idempotent` liking twice leaves one like.
- `save-on` / `save-off` saves and unsaves; the Saved tab lists saved games newest-saved first.
- `me-counts` Me's liked and saved counters.
- `signed-out` refuses a like or save with 401.

## How to get to it (user POV)

- The heart on a game in Discover or the Saved feed: `apps/mobile/components/feed.tsx` → `PUT`/`DELETE /api/games/<id>/like`.
- The bookmark on the same screens → `PUT`/`DELETE /api/games/<id>/save`.
- The Saved tab: `apps/mobile/app/(tabs)/saved.tsx` → `GET /api/saves`. Tapping a saved game opens `apps/mobile/app/saved-feed.tsx`.
- The Me tab: `apps/mobile/app/(tabs)/me.tsx` → `GET /api/likes/count`, `GET /api/saves/count`.

## Driving it with call.sh

Preconditions:

- Baseline run, doctor healthy. `user_alice` has not liked or saved anything.

- **Before.** Read the feed as Alice. Run `$S/call.sh "$RUN" feed-before GET /api/games --as user_alice:alice`. Odd Duck (2) reads `liked:false, likes:0`.
- **Like.** Tap the heart on Odd Duck. Run `$S/call.sh "$RUN" like PUT /api/games/2/like --as user_alice:alice`. 200, `{"liked":true,"likes":1}`.
- **Feed after.** Run `$S/call.sh "$RUN" feed-after GET /api/games --as user_alice:alice`. Game 2 reads `liked:true, likes:1`; games 1 and 3 are unchanged.
- **Me count.** Run `$S/call.sh "$RUN" likes-count GET /api/likes/count --as user_alice:alice`. `{"count":1}`.
- **Stored.** Run `$S/sql.sh "$RUN" likes-row "SELECT * FROM likes"`. One row: `game_id 2, user user_alice`.
- **Like again.** Run `$S/call.sh "$RUN" like-again PUT /api/games/2/like --as user_alice:alice`. Still `likes:1`; `likes` still has one row.
- **Others see the count.** Run `$S/call.sh "$RUN" feed-bob GET /api/games --as user_bob:bob`. Game 2 reads `likes:1, liked:false`.
- **Unlike.** Run `$S/call.sh "$RUN" unlike DELETE /api/games/2/like --as user_alice:alice`. `{"liked":false,"likes":0}`, and no `likes` row remains.
- **Save.** Run `$S/call.sh "$RUN" save PUT /api/games/1/save --as user_alice:alice`. `{"saved":true}`, with no count, because saves are private. Then run `$S/call.sh "$RUN" saved-tab GET /api/saves --as user_alice:alice`: `games` holds game 1 with `saved:true`. And `GET /api/saves/count` reads `{"count":1}`.
- **Unsave.** Run `$S/call.sh "$RUN" unsave DELETE /api/games/1/save --as user_alice:alice`. `{"saved":false}`; `/api/saves` is empty.
- **Signed out.** Run `$S/call.sh "$RUN" like-signed-out PUT /api/games/2/like`. 401 `{"error":"Sign in to continue."}`, and no row is added.

## Gotchas

- A like on a missing game, or one across a Block, is a 404 "This game isn't available.", not a 401.
- The app patches its state from the response optimistically and rolls back on failure. A wrong count in the response is a bug even if the next feed load corrects it.
- `/api/saves` pages by save id (`next` is a `saveId`), not by game id.
