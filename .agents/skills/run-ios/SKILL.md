---
name: run-ios
description: Run the hopon app in the iOS Simulator against the local API. Use when asked to run, screenshot, or check a change in the app.
---

First-time setup (`.env`, `.dev.vars`, Clerk keys) is in the README's 准备 section. This covers each run.

## Steps

1. **Database.** `pnpm run db:local`. Done when it reports the migrations applied, or none to apply.
2. **API.** Start `pnpm run api:offline` in the background. Done when `curl -sf localhost:8787/api/games` returns JSON. Offline mode can't generate games; use `pnpm run api` (Workers AI, costs quota) only when the change is about creating.
3. **Metro.** Open the simulator panel if your harness has one, then start `CI=1 pnpm run ios` in the background with its output going to a log. `CI=1` keeps Expo non-interactive, and it also turns off reloading: after editing app code, restart this command. Done when the log shows `iOS Bundled`.
4. **Load the current bundle.** Open `exp://127.0.0.1:8081` in the simulator. Expo Go keeps running whatever bundle it last loaded, including one from an earlier Metro, until this URL reloads it. Done when the screen shows your change; the old bundle looks plausible, so check for something your diff added.
5. **Drive it.** Screenshots trail one action behind: after a tap, take a second screenshot before reading the result. The dev-tools gear button floats over the bottom-left of the ticket, so tap around it.
6. **Stop** the API and Metro background processes when the run is over.

## Accounts

The simulator is usually signed in to a Clerk test account (`…+clerk_test@example.com`). Signing in is the human's step: Clerk's development instance accepts its fixed test code for `+clerk_test` addresses, and the human enters it. So ask before signing out, and say the human will need to sign back in.
