# Comments

Each game has a comment sheet. Anyone signed in with a Handle can post a comment of 1–300 characters, shown with their Handle. A commenter can delete their own comment, and a game's creator can delete any comment on their game. Signed-in users without a Handle are asked to pick one first.

## Sub-features

- `comments-read` lists a game's comments, newest first, 30 per page.
- `comment-post` posts as an account with a Handle; the game's comment count rises.
- `comment-needs-handle` refuses an account without one.
- `comment-length` refuses an empty comment or one over 300 characters.
- `comment-delete-own` lets the commenter delete.
- `comment-delete-creator` lets the game's creator delete someone else's comment.
- `comment-delete-other` gives anyone else a 404.

## How to get to it (user POV)

- The speech bubble on a game opens the sheet: `apps/mobile/components/comments-sheet.tsx` → `GET /api/games/<id>/comments`.
- Typing and sending in the sheet → `POST /api/games/<id>/comments` with `{"body": "…"}`.
- A comment's menu → Delete → `DELETE /api/comments/<id>`.

## Driving it with call.sh

Preconditions:

- Baseline run, doctor healthy. Game 2 has no comments.

- **No Handle.** Bob, who hasn't picked a name, sends a comment. Run `$S/call.sh "$RUN" comment-nohandle POST /api/games/2/comments --as user_bob --json '{"body":"Nice duck"}'`. 400 `{"error":"Pick your name before commenting."}`.
- **Post.** Bob, now with Handle `bob`, sends it. Run `$S/call.sh "$RUN" comment POST /api/games/2/comments --as user_bob:bob --json '{"body":"Nice duck"}'`. 201, with `author:"bob"`, `body:"Nice duck"`, `mine:true`, `canDelete:true` and an `id`.
- **Others read it.** Alice opens the sheet. Run `$S/call.sh "$RUN" comments GET /api/games/2/comments --as user_alice:alice`. One comment by `bob`, `mine:false, canDelete:false`. The feed's game 2 now reads `comments:1`.
- **Too long.** Run `$S/call.sh "$RUN" comment-long POST /api/games/2/comments --as user_bob:bob --json "{\"body\":\"$(printf 'x%.0s' $(seq 301))\"}"`. 400 "Write a comment of 1–300 characters."
- **Delete by someone else.** Run `$S/call.sh "$RUN" delete-other DELETE /api/comments/<id> --as user_alice:alice`. 404 "Comment not found."; the row is still there (`$S/sql.sh "$RUN" comments-rows "SELECT id,user,body FROM comments"`).
- **Delete own.** Run `$S/call.sh "$RUN" delete-own DELETE /api/comments/<id> --as user_bob:bob`. 204; the comment list is empty and the `comments` table has no row.
- **Delete as creator.** On an Original, the creator is `hopon`. Post another comment as Bob, then run `$S/call.sh "$RUN" delete-creator DELETE /api/comments/<id> --as hopon`. 204.

## Gotchas

- Offline, Screening is skipped, so a comment that breaks the Rules posts here. Refusals by Llama Guard are not verifiable with this skill.
- Each account can post 100 comments a day (`generation_limits`). A loop that posts many from one account hits a 429.
- Comments across a Block are hidden both ways, and commenting on a blocked poster's game is a 404 (see [block.md](./block.md)).
- `canDelete` is true for the commenter and for the game's creator. Check it from both accounts.
