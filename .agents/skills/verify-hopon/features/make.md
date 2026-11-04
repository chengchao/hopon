# Make (Drafts)

Make is where a Creator chats with the Maker to build a game. The first message starts a Draft. The Talker replies and has the Coder build Revisions. The Creator plays the current Revision through a signed preview link and publishes it to Discover under their Handle. Each Creator has a weekly Allowance of hopon tokens.

## Sub-features

- `draft-start` starts a Draft with the first message.
- `draft-list` lists the Creator's Drafts, most recently updated first.
- `draft-delete` deletes one Draft, or all of them.
- `allowance` shows how much of the week's Allowance is left.
- `draft-preview` signs a one-hour link to the current Revision's page.
- `draft-publish` turns the current Revision into a published Game.
- `maker-chat` (not drivable offline) covers the Talker's replies and builds, over the WebSocket.

## How to get to it (user POV)

- The Make tab: `apps/mobile/app/create.tsx` → `GET /api/drafts` and `GET /api/allowance`; the first message → `POST /api/drafts` with `{"text":"…"}`; later ones → `POST /api/drafts/<id>/messages`; Stop → `POST /api/drafts/<id>/stop`.
- The chat stream: `apps/mobile/lib/maker-socket.ts` → `POST /api/drafts/<id>/ws-ticket`, then `GET /api/drafts/<id>/ws`.
- Play: `apps/mobile/components/play.tsx` → `GET /api/drafts/<id>/preview`. Publish: `apps/mobile/components/publish-sheet.tsx` → `POST /api/drafts/<id>/publish`.
- Me's Drafts list: `apps/mobile/components/draft-list.tsx` → `GET /api/drafts`, `DELETE /api/drafts/<id>`.

## Driving it with call.sh

Preconditions:

- Baseline run, doctor healthy.
- For preview and publish, a seeded Revision (see Gotchas).

- **Start.** Alice sends her first idea. Run `$S/call.sh "$RUN" draft POST /api/drafts --as user_alice:alice --json '{"text":"A game with a cat"}'`. 201, `{"id":"<64 hex>","message":"<uuid>"}`.
- **List.** Run `$S/call.sh "$RUN" drafts GET /api/drafts --as user_alice:alice`. One Draft with that id, `title:null`. Bob's list is empty.
- **Allowance.** Run `$S/call.sh "$RUN" allowance GET /api/allowance --as user_alice:alice`. 200 with this week's remaining tokens. Compare it with `MAKER_WEEKLY_TOKENS` in `wrangler.jsonc`.
- **No game yet.** Run `$S/call.sh "$RUN" preview-none GET /api/drafts/<id>/preview --as user_alice:alice`. 404 "This Draft has no game yet."
- **Preview.** With a seeded Revision `1` (Gotchas), run `$S/call.sh "$RUN" preview GET /api/drafts/<id>/preview --as user_alice:alice`. A `url` of the form `/drafts/<id>/1/<exp>.<sig>/index.html`. Fetching its path with `call.sh` (no `--as`) is a 200 with the page, and changing one character of the signature makes it a 404.
- **Publish.** With a seeded title and Revision, run `$S/call.sh "$RUN" publish POST /api/drafts/<id>/publish --as user_alice:alice`. Success, and `GET /api/games` lists the new game first, with `author:"alice"`, `mine:true` for Alice and its page served. Without a Handle (`--as user_alice`) it's a 400 "Pick your name before publishing."
- **Delete.** Run `$S/call.sh "$RUN" draft-delete DELETE /api/drafts/<id> --as user_alice:alice`, then `GET /api/drafts`. Empty.

## Gotchas

- The Maker's replies and builds are out of reach. The Talker's model calls need `CLOUDFLARE_API_KEY`, which this run forces empty, and builds need the Coder's Docker box (`pnpm -F worker dev:coder`). `POST /api/drafts` still returns 201, because the Talker takes the message, but no reply ever streams. Report the chat as unverified. A real build is `pnpm -F worker smoke:coder` against `dev:coder`, which makes real model calls.
- Preview and publish need a Revision the Coder never made here. Seed it as `run-ios`'s "Other accounts' content" describes: `UPDATE drafts SET title='Cat Run' WHERE id='<id>'` with `sql.sh`, plus an Original's page put at R2 `drafts/<id>/1/index.html` with `pnpm -F worker exec wrangler r2 object put hopon/drafts/<id>/1/index.html --local --persist-to "$STATE/wrangler" --file <page>`. Fetch the page first with `call.sh … GET /games/2/index.html`. Say in the report that the Revision was seeded.
- A Creator holds at most a few Drafts at once (`MAX_DRAFTS`); one more is a 409 "Delete a Draft to start a new one."
- Offline, Screening of the message and the publish text is skipped.
