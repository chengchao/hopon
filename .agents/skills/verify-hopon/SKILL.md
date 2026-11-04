---
name: verify-hopon
description: Prove hopon's user-facing behavior by driving an isolated local hopon API (the Cloudflare Worker the iOS app talks to) over HTTP, as a signed-in Clerk account or as the Operator, and capturing request/response and D1 evidence. Use to verify a change to the feed, likes, saves, comments, reports, blocks, the Operator page, or Drafts, especially where no iOS Simulator is available. For the app's own screens on a simulator, use run-ios.
---

# Verify hopon

hopon's users touch an Expo iOS app (`apps/mobile`). Every feature in it is a call to the Worker API (`apps/worker`), plus the Operator's `/operator` web page, which has no script. This skill drives that API the way the app does: same routes, same `Authorization: Bearer <Clerk session JWT>`, same JSON bodies. Each run gets its own port, D1/R2 state and keys, so it never touches the developer's `pnpm run api` instance on 8787 or another session's run.

The app's screens themselves (layout, gestures, the game WebView) need the iOS Simulator and Xcode: that is the `run-ios` skill. A UI change gets proved there. A behavior change gets proved here, and a change to both gets proved in both. This skill needs no `.env`, `.dev.vars` or Clerk dashboard access.

All commands run from the repo root. `S=.agents/skills/verify-hopon/scripts`.

## Launch

```sh
S=.agents/skills/verify-hopon/scripts
RUN=$($S/launch.sh | sed -n 's/^RUN=//p'); echo "$RUN"
```

`launch.sh` installs dependencies if `node_modules` is missing. It then creates `.verify/<stamp>-<pid>/` (gitignored), with `state/` for scratch and `evidence/` for proof. In `state/` it generates an RSA key pair that stands in for the Clerk instance's JWT key, plus an Operator password and a `PREVIEW_SECRET`. It applies every D1 migration to a fresh `--persist-to` dir and copies the seeded Originals' pages to that state's R2 (`games-to-r2.mjs --persist-to`). Last, it starts `wrangler dev --local --var HOPON_OFFLINE:1` on the first free port from 8790 in its own process group. It prints `RUN=<dir>` only once **ready**: `/api/games` lists a game and that game's `/games/<id>/index.html` is served. A port that merely answers doesn't count. A fresh run takes about 15 s.

The run's settings live in `$RUN/run.env`: `ORIGIN`, `PORT`, `PGID`, `OPERATOR_PASSWORD`, `STATE`, `WORKER`. Source it when you need `$ORIGIN`.

What this instance is and isn't:

- **Offline.** No Workers AI, so Screening (Llama Guard) is skipped: comments, Draft messages and publish text go straight through. To prove a Screening refusal, use `run-ios` step 2's `TEMP-SIM` approach or `pnpm run api` (real AI, costs quota). Don't claim a refusal was verified here.
- **Self-signed Clerk tokens.** The Worker's real `verifyToken` checks them against this run's public key, so auth runs the production code path. What it doesn't prove is the Clerk instance's config: that real sessions carry the `username` claim.
- **Unset on purpose:** `CLERK_SECRET_KEY` (so the Operator's Ban can't reach Clerk), `OPERATOR_WEBHOOK_URL` (no report notifications leave the machine), and `CLOUDFLARE_API_KEY` (so the Talker and Coder make no model calls). Each is forced empty with `--var`, so a developer's shell environment can't fill it. `--env-file` keeps `apps/worker/.dev.vars` from loading at all.

## Doctor

Run this first whenever anything looks off, and before trusting a run you didn't just launch:

```sh
$S/doctor.sh "$RUN"
```

It is read-only and prints one `ok`/`FAIL` line per check:

1. The process group is alive.
2. The port's listener is in our group, and its working dir is this checkout's `apps/worker`.
3. `/api/version` matches `MIN_IOS_BUILD` in `wrangler.jsonc`, so this is the checkout's build.
4. The feed lists games, and a game's page comes from R2.
5. A token signed for this run is accepted.
6. The Operator password opens `/operator`.

A `FAIL` names what to do. When in doubt, clean up and launch again; a fresh run is cheap.

## Drive

Read [features/README.md](features/README.md), then the feature's file. Two helpers do every step, and each records what it did as evidence.

**HTTP, as a user or the Operator:**

```sh
$S/call.sh "$RUN" <label> <METHOD> <path> [--as <user_id>[:<handle>]] [--json '<body>'] [--operator]
```

- `--as user_alice:alice` signs in as account `user_alice` with Handle `alice`. `--as user_bob` is an account that hasn't picked a Handle yet: commenting and publishing refuse it.
- `--operator` sends Basic auth plus `Sec-Fetch-Site: same-origin`, as the Operator page's own form posts do. Without that header, `csrf()` refuses writes.
- No `--as` means signed out. The Worker rejects every non-GET `/api/*` request from a signed-out caller with 401.
- It prints `HTTP/1.1 <status>  (<evidence file>)` on stderr and the response body on stdout, so you can pipe the body to `node -e`/`jq`.

Account ids are any `user_…` string. Each one is a new account the first time it acts, so use fresh ones per journey (`user_alice`, `user_bob`, …). The seeded Originals (games 1–3: Toast Panic, Odd Duck, Bubble Pop, newest first in the feed) belong to the `hopon` account. Signing in as that owner is the only way to act as their creator.

**D1, for side effects and seeding:**

```sh
$S/sql.sh "$RUN" <label> "SELECT …"
```

Use SELECTs to prove what a request stored. Writes only seed preconditions that no API path creates (a Draft with a Revision, another account's game): never use a write to perform the action you are verifying.

**Signing a token by hand:** `node $S/token.mjs "$RUN" <user_id> [handle]` prints a bearer token valid for an hour, for a `curl` or a WebSocket client.

## Evidence

Everything lands in `$RUN/evidence/`, numbered in the order it happened:

- `NN-<label>.http`: the request line (method, path, who, body), a UTC timestamp, then the full response: status, headers and body.
- `NN-<label>.sql.txt`: the query, a timestamp and the rows.

Proof standards:

- **Real user path.** Call the routes the app calls (the feature file names each one, with the app file that calls it). Use no test-only endpoints, and seed nothing via SQL for the step under test.
- **Action plus resulting state.** Capture the state before, the action, and a second read-only view after: the feed or list the app would reload, and the D1 rows. A 2xx on the action alone proves nothing.
- **Side effects.** A like is a `likes` row, a report a `reports` row, an Operator Delete closes reports and removes the content. Check them with `sql.sh`.
- **Refusals count.** A refused journey (401, 400 "Pick your name…", 404 across a Block) is proved by its status and message, plus the absence of the row.
- **Mocks only at Clerk's boundary.** The self-signed JWT replaces the Clerk instance, which the Worker already only meets through `CLERK_JWT_KEY`. Nothing else is mocked. Offline mode *skips* Screening rather than mocking it, so Screening stays unverified.

When you report, give the evidence dir and the files that prove each claim.

## Cleanup

```sh
$S/cleanup.sh "$RUN"        # or: $S/cleanup.sh --all   (every run under this checkout's .verify/)
```

It sends TERM, then KILL, to the run's process group only. It kills nothing by name or by port alone: a listener on the port that isn't in our group gets reported and left alone. Then it deletes `$RUN/state` and `run.env`, and **keeps `$RUN/evidence/`**. Run it after every attempt, failed ones too, so broken runs don't strand `workerd` on a port. Delete old `.verify/<run>/` dirs yourself once their evidence is no longer needed.

Check it worked: `lsof -iTCP:<port> -sTCP:LISTEN` prints nothing, and `ls "$RUN/evidence"` still lists the proof.

## Helpers

All are in `scripts/`, executable, and documented in their first lines:

| Script | Does |
| --- | --- |
| `launch.sh` | Fresh isolated instance; prints `RUN=<dir>` when usable. `PORT=<n>` moves the port search start. |
| `doctor.sh <run>` | Read-only health check, described above. |
| `call.sh <run> <label> …` | One recorded HTTP request. |
| `sql.sh <run> <label> "<SQL>"` | One recorded D1 query against this run's state. |
| `token.mjs <run> <user> [handle]` | Prints a session JWT the run accepts. |
| `cleanup.sh <run>\|--all` | Stops the run and drops its state, keeping its evidence. |

## Isolation

Runs share nothing but the checkout's `node_modules` and `apps/worker/.wrangler/tmp` (wrangler's bundle scratch, per process). Two runs side by side work: the second takes the next free port. Never drive `localhost:8787` or `:8081` from this skill: those are the developer's `pnpm run api` and Metro, with their real data and Clerk keys.
