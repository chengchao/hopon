---
name: run-ios
description: Run the hopon app in the iOS Simulator against the local API. Use when asked to run, screenshot, or check a change in the app.
---

First-time setup (`.env`, `.dev.vars`, Clerk keys) is in the README's 准备 section. This covers each run.

## Steps

1. **Database.** `pnpm run db:local`. Done when it reports the migrations applied, or none to apply. On a fresh local database, also run `pnpm -F worker games-to-r2` once: the Originals' files go to local R2, where the feed plays them from.
2. **API.** Start `pnpm run api:offline` in the background with its output going to a log, which step 5 reads. Done when `curl -sf localhost:8787/api/games` returns JSON. Offline mode skips Screening; use `pnpm run api` (Workers AI, costs quota) only when the change is about Screening. Neither runs the Coder, so a build in Make fails: a real build needs `pnpm -F worker dev:coder` (Docker), or seed a Draft (below). Llama Guard won't refuse the test account's Handle or ordinary text, so to see a refusal in the app, stay offline and make `screen`'s offline branch in `apps/worker/src/api.ts` fail for the `what` you need, on one line ending `// TEMP-SIM`. The pre-commit hook refuses a staged `TEMP-SIM`, so delete the line when the run is over.
3. **Metro.** Open the simulator panel if your harness has one, then start `CI=1 pnpm start` in the background with its output going to a log. `CI=1` keeps Expo non-interactive, and it also turns off reloading: after editing app code, restart this command. `pnpm start` opens no simulator itself; step 4 opens the app on one. Done when the log says it is waiting on `http://localhost:8081`; the log shows `iOS Bundled` once step 4 has loaded the app.
4. **Load the current bundle.** Expo Go keeps running whatever bundle it last loaded, including one from an earlier Metro, and the old bundle looks plausible on screen. From the repo root, run `.agents/skills/run-ios/scripts/reload.sh <api-log>`: it quits Expo Go, reopens it on this Metro, and waits for the app's feed request in step 2's log. It drives one simulator, chosen by `scripts/device.sh`: the only booted one, or `SIM_UDID` when several are booted (it fails and lists them). Another session may own the others, so set `SIM_UDID` to the device the simulator panel attached to, on every command that takes one. Done when it exits 0 (it can take 30 seconds). Then open Me: if it shows Sign in, ask the human to sign in now (see Accounts), and keep setting up while they do.
5. **Drive it.** Screenshots trail one action behind: after a tap, take a second screenshot before reading the result. After a tap that changes screen (a tab, a push, a modal), wait for a screenshot showing the new screen before the next tap; a tap sent during the transition lands on the old screen. A sheet (a `Modal`) or an alert drops taps for about a second as it appears or closes, so wait 2s after either. React Native's `Switch` ignores the simulator's taps: tap the row it sits in, which is the control (`accessibilityRole="switch"`). Expo Go's dev-tools gear sits top right, and its touch area reaches well past the icon, so a control near it (a header's Done, a ticket button) can't be tapped in Expo Go: check that control in code or a real build. A swipe sent within about a second of a tap on a game is dropped, so screenshot that the feed moved before reading anything into what the game did. A modal screen (Make, Handle, Blocked) closes by swiping it down; Make sits over the tabs, so swipe it down to get back to them. The comment and report sheets are see-through `Modal`s that don't swipe: tap the comment sheet's Close, which sits clear of the gear, or the dimmed area above the report sheet.

   Full-size screenshots are large, and the simulator tool's `screenshot` is always full-size. To navigate, save one at the device's point size instead, where its pixels are tap coordinates (attaching reports the size: 390x844 on an iPhone 16e; `-Z` takes its height), and read the file. Keep full-size screenshots for reading small text.

   ```sh
   xcrun simctl io "$(.agents/skills/run-ios/scripts/device.sh)" screenshot "$TMPDIR/shot.png" && sips -Z 844 "$TMPDIR/shot.png"
   ```

   To check a size or position, `python3 -I .agents/skills/run-ios/scripts/edges.py <full-size.png> row|col <points>` prints where the colour changes along that line, in points.

   A game's own state (paused, its clock, the volume) doesn't show on screen, and `GameView` has no `onMessage`. To read it, add a temporary `onMessage` that `console.log`s to Metro's log, and an `injectJavaScript` that posts the globals back (`window.ReactNativeWebView.postMessage(JSON.stringify({p: getPaused(), t: time, v: soundVolume}));true`), each on a line ending `// TEMP-SIM`.

   When a screenshot leaves it unclear whether an action reached the server, read the API log for its request line (`[wrangler:info] PUT /api/games/2/save 200 OK`), or query the local database with `pnpm -F worker exec wrangler d1 execute DB --local --command "SELECT …"`.
6. **Stop** the API and Metro when the run is over. Killing the `pnpm` commands leaves `workerd` and Metro's `node` listening, so stop whatever this checkout has on their ports. From the repo root:

   ```sh
   for port in 8787 8081; do for p in $(lsof -tiTCP:$port -sTCP:LISTEN); do
     lsof -a -p $p -d cwd -Fn | grep -q "^n$PWD" && kill $p
   done; done
   ```

   Done when `lsof -iTCP:8787 -iTCP:8081 -sTCP:LISTEN` prints nothing.

## Accounts

The simulator is usually signed in to a Clerk test account (`…+clerk_test@example.com`). Signing in is the human's step: Clerk's development instance accepts its fixed test code for `+clerk_test` addresses, and the human enters it. So ask before signing out, and say the human will need to sign back in.

## Flows through Clerk

An action the API takes through Clerk's Backend API (Ban) needs `CLERK_SECRET_KEY` in `apps/worker/.dev.vars` (README step 4); without it Clerk answers 401 and the app shows the API's 502. One that needs a second real account (the poster to Ban, the banned person signing in) gets a throwaway one, once the human has agreed to it being created:

```sh
clerk users create -d '{"email_address":["<name>+clerk_test@example.com"],"username":"<name>"}' --instance dev --yes
```

Seed its content by its id, as below. Clerk sends a banned account a sign-in code and refuses it only at the code step, so checking the banned message means the human enters the code. Deleting the account afterwards is the human's step too: give them `clerk api /users/<id> -X DELETE`.

The simulator's `text` action can drop the end of what it types (it lost `@example.com` from an email). Screenshot a field before submitting it, and type the missing part.

## Other accounts' content

Checking what the signed-in account sees on someone else's game or comment needs rows written as another account, which only SQL can do. Find the simulator account's id from what it has written (`SELECT owner FROM games` / `SELECT user FROM likes`), or from `clerk users list --instance dev` in a fresh local database where it has written nothing; insert content as any other `user_…` id with `pnpm -F worker exec wrangler d1 execute DB --local --command "INSERT …"`, and delete those rows before step 6. A published Game is a `games` row plus its files in R2 under `games/<id>/`, so a seeded one borrows an Original's page (from `apps/worker`, with the id the `INSERT` returned):

```sh
pnpm exec wrangler d1 execute DB --local --command "INSERT INTO games (owner, author, title, description) VALUES ('user_rival', 'rival', 'Rival Run', 'A seeded game.') RETURNING id"
pnpm exec wrangler r2 object get hopon/games/2/index.html --local --file "$TMPDIR/index.html"
pnpm exec wrangler r2 object put hopon/games/<id>/index.html --local --file "$TMPDIR/index.html"
```

To check Make's chat, Play and Publish without the Coder, seed a Draft as the simulator account itself: a `drafts` row (`id` is 64 hex characters, `owner` the account's id, a `title`) and its first Revision's files at `drafts/<id>/1/` (`index.html`, the same way). Make opens the most recently updated Draft, and Publish turns its Revision into a Game in Discover.

Reports are seeded the same way: `INSERT INTO reports … SELECT` the snapshot columns from the game or comment being reported, with any `user_…` id as the reporter.
