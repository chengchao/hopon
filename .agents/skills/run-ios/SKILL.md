---
name: run-ios
description: Run the hopon app in the iOS Simulator against the local API. Use when asked to run, screenshot, or check a change in the app.
---

First-time setup (`.env`, `.dev.vars`, Clerk keys) is in the README's 准备 section. This covers each run.

## Steps

1. **Database.** `pnpm run db:local`. Done when it reports the migrations applied, or none to apply.
2. **API.** Start `pnpm run api:offline` in the background with its output going to a log, which step 5 reads. Done when `curl -sf localhost:8787/api/games` returns JSON. Offline mode can't generate games; use `pnpm run api` (Workers AI, costs quota) only when the change is about creating.
3. **Metro.** Open the simulator panel if your harness has one, then start `CI=1 pnpm run ios` in the background with its output going to a log. `CI=1` keeps Expo non-interactive, and it also turns off reloading: after editing app code, restart this command. Done when the log shows `iOS Bundled`.
4. **Load the current bundle.** Expo Go keeps running whatever bundle it last loaded, including one from an earlier Metro, and opening the URL again while it runs reloads nothing. Quit it first, then open the URL:

   ```sh
   xcrun simctl terminate booted host.exp.Exponent; xcrun simctl openurl booted exp://127.0.0.1:8081
   ```

   Done when the API log gains a new `GET /api/games` line, which the feed requests on load. The old bundle looks plausible on screen, so go by the log.
5. **Drive it.** Screenshots trail one action behind: after a tap, take a second screenshot before reading the result. After a tap that changes screen (a tab, a push, a modal), wait for a screenshot showing the new screen before the next tap; a tap sent during the transition lands on the old screen. The dev-tools gear button floats over the bottom-left of the ticket, so tap around it.

   When a screenshot leaves it unclear whether an action reached the server, read the API log for its request line (`[wrangler:info] PUT /api/games/2/save 200 OK`), or query the local database with `pnpm -F api exec wrangler d1 execute DB --local --command "SELECT …"`.
6. **Stop** the API and Metro when the run is over. Killing the `pnpm` commands leaves `workerd` and Metro's `node` listening, so stop whatever this checkout has on their ports. From the repo root:

   ```sh
   for port in 8787 8081; do for p in $(lsof -tiTCP:$port -sTCP:LISTEN); do
     lsof -a -p $p -d cwd -Fn | grep -q "^n$PWD" && kill $p
   done; done
   ```

   Done when `lsof -iTCP:8787 -iTCP:8081 -sTCP:LISTEN` prints nothing.

## Accounts

The simulator is usually signed in to a Clerk test account (`…+clerk_test@example.com`). Signing in is the human's step: Clerk's development instance accepts its fixed test code for `+clerk_test` addresses, and the human enters it. So ask before signing out, and say the human will need to sign back in.

## Other accounts' content

Checking what the signed-in account sees on someone else's game or comment needs rows written as another account, which only SQL can do. Find the simulator account's id from what it has written (`SELECT owner FROM games` / `SELECT user FROM likes`), insert content as any other `user_…` id with `pnpm -F api exec wrangler d1 execute DB --local --command "INSERT …"`, and delete those rows before step 6.
