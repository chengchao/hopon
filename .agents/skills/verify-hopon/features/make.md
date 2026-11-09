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
- For preview and publish, `$S/seed-revision.sh` gives the Draft Revision 1 and a title (see Gotchas).

- **Start.** Alice sends her first idea. Run `$S/call.sh "$RUN" draft POST /api/drafts --as user_alice:alice --json '{"text":"A game with a cat"}'`. 201, `{"id":"<64 hex>","message":"<uuid>"}`. Keep the id: `id=$(… | node -pe 'JSON.parse(require("fs").readFileSync(0)).id')`.
- **List.** Run `$S/call.sh "$RUN" drafts GET /api/drafts --as user_alice:alice`. One Draft with that id, `title:null, description:null`. `--as user_bob:bob` gets `{"drafts":[]}`.
- **Allowance.** Run `$S/call.sh "$RUN" allowance GET /api/allowance --as user_alice:alice`. `{"left":40000000,"resetsAt":"<next Monday 00:00Z>","weekly":40000000}`, where `weekly` is `MAKER_WEEKLY_TOKENS` in `wrangler.jsonc`. Offline, nothing spends it.
- **No game yet.** Run `$S/call.sh "$RUN" preview-none GET /api/drafts/$id/preview --as user_alice:alice`. 404 "This Draft has no game yet." Publish (`POST /api/drafts/$id/publish`) is a 409 with the same message.
- **Seed the Revision.** Run `$S/seed-revision.sh "$RUN" "$id" "Cat Run"`. It prints `Draft <id> has Revision 1 and title 'Cat Run'`, and it's safe to rerun.
- **Preview.** Run `$S/call.sh "$RUN" preview GET /api/drafts/$id/preview --as user_alice:alice`. `{"url":"$ORIGIN/drafts/<id>/1/<exp>.<sig>/index.html"}`, with `exp` an hour ahead. Fetch the URL's path signed out (`$S/call.sh "$RUN" preview-page GET "<path>"`). 200, the page's HTML.
- **Bad link.** Change the signature's first character, or set `exp` to a past time such as `1000000000`, and fetch it again. 403 "This link has expired." for both.
- **Publish needs a Handle.** Run `$S/call.sh "$RUN" publish-nohandle POST /api/drafts/$id/publish --as user_alice`. 400 "Pick your name before publishing."
- **Publish.** Run `$S/call.sh "$RUN" publish POST /api/drafts/$id/publish --as user_alice:alice`. 201 `{"id":<game id>}`. `GET /api/games --as user_alice:alice` then lists it first, with `title:"Cat Run", author:"alice", mine:true`. `GET /games/<game id>/index.html` is a 200, and `GET /api/drafts` is `{"drafts":[]}`, because publishing deletes the Draft.
- **Delete one.** Start another Draft, then run `$S/call.sh "$RUN" draft-delete DELETE /api/drafts/$id2 --as user_alice:alice`. 204. Deleting it again is a 404 "Draft not found."
- **Cap.** A Creator holds at most 20 Drafts (`MAX_DRAFTS` in `packages/schemas/index.ts`). With 20, the next `POST /api/drafts` is a 409 "Delete a Draft to start a new one." `DELETE /api/drafts` (no id) deletes them all with a 204, and `$S/sql.sh "$RUN" drafts-left "SELECT owner, count(*) n FROM drafts GROUP BY owner"` returns `[]`.

## Gotchas

- The Maker's replies and builds are out of reach. The Maker's model calls need `CLOUDFLARE_API_KEY`, which this run forces empty, and builds need its Docker box (`pnpm -F worker dev:maker`). `POST /api/drafts` still returns 201, because the Maker takes the message, but no reply ever streams. Report the chat as unverified. A real build is `pnpm -F worker smoke:maker` against `dev:maker`, which makes real model calls.
- Preview and publish need a Revision, which the Maker never makes here. `seed-revision.sh` copies Odd Duck's page to R2 `drafts/<id>/1/index.html` and sets the Draft's title, the two things publish checks. Say in the report that the Revision was seeded. The published game plays Odd Duck, not the idea the Draft was started with.
- Publish deletes the Draft, so run the Delete steps on a different Draft.
- A preview link's failure is always a 403 "This link has expired.", whether the signature is wrong or the time has passed. A 404 means the signature was good but the file is missing.
- Offline, Screening of the message and the publish text is skipped.
