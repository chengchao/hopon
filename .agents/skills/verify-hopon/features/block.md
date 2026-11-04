# Block

From a game's or comment's "…" menu, a user blocks the account behind it. After that, neither side sees the other's games or comments anywhere, neither can comment on the other's games, and the blocked account isn't told. Me → Blocked lists blocked accounts by Handle, and Unblock lifts a block.

## Sub-features

- `block-from-game` / `block-from-comment` blocks the poster.
- `block-self` refuses blocking yourself.
- `block-hides` removes the poster's games from the blocker's feed and theirs both ways, and hides comments.
- `block-no-comment` gives a 404 for commenting on a blocked poster's game.
- `blocked-list` lists blocks newest first, with Handles.
- `unblock` lifts a block; content the blocker also reported stays hidden.

## How to get to it (user POV)

- "…" on a game or a comment → Block → confirm: `apps/mobile/components/report-sheet.tsx` → `POST /api/games/<id>/block` or `POST /api/comments/<id>/block`.
- Me → Blocked: `apps/mobile/app/blocked.tsx` → `GET /api/blocks`; Unblock → `DELETE /api/blocks/<id>`.
- Me shows the count: `apps/mobile/app/(tabs)/me.tsx` → `GET /api/blocks`.

## Driving it with call.sh

Preconditions:

- Baseline run, doctor healthy. Bob has a comment on game 2 (see [comments.md](./comments.md)), which gives a comment `<cid>`.

- **Block from a comment.** Alice blocks Bob from his comment. Run `$S/call.sh "$RUN" block POST /api/comments/<cid>/block --as user_alice:alice`. 204.
- **List.** Run `$S/call.sh "$RUN" blocked GET /api/blocks --as user_alice:alice`. `{"blocks":[{"handle":"bob","id":<bid>}]}`. Bob's own `GET /api/blocks` is empty, so the blocked side isn't told.
- **Hidden.** Run `$S/call.sh "$RUN" comments-hidden GET /api/games/2/comments --as user_alice:alice`. Bob's comment is absent; Bob still sees it.
- **Self.** Alice comments on game 2, then blocks from her own comment: 400 "You can't block yourself."
- **Block from a game.** Run `$S/call.sh "$RUN" block-game POST /api/games/2/block --as user_carol:carol`, which blocks `hopon`. Then `GET /api/games --as user_carol:carol` lists no `hopon` games (an empty `games`), and commenting on game 2 as Carol is a 404 "This game isn't available."
- **Unblock.** Run `$S/call.sh "$RUN" unblock DELETE /api/blocks/<bid> --as user_alice:alice`. 204; `/api/blocks` is empty and Bob's comment shows again. Someone else's `<bid>` gets a 404 "Block not found."

## Gotchas

- Every seeded game belongs to `hopon`, so blocking from a game blanks the whole seeded feed for that account. Use a fresh account for it (Carol above), not one later steps need.
- The stored Handle is the one at block time (`blocks.handle`); it doesn't follow a later rename.
- Reporting after a Block is how the app offers it ("…then offer a report"); both rows are independent.
