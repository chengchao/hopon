# hopon verification map

This directory is the maintained source for verifying hopon's user-facing behavior through its API. Read this index, then use the matching feature file as the recipe. A proof that drives one entry point is incomplete when the feature's file lists others.

## Baseline preconditions

- A run from `.agents/skills/verify-hopon/scripts/launch.sh`, with `$RUN` set to the dir it printed and `S=.agents/skills/verify-hopon/scripts`.
- `$S/doctor.sh "$RUN"` prints `healthy`.
- Seed data is the migrations' only: three published Originals by `hopon` (ids 1 Toast Panic, 2 Odd Duck, 3 Bubble Pop; the feed lists 3, 2, 1). There are no other accounts, likes, comments, saves, reports, blocks or Drafts.
- Never drive an instance this run didn't start (8787 is the developer's).

## Driving conventions

- One fresh `user_…` id per role in a journey (`user_alice:alice` acts, `user_bob:bob` is the other party). Ids from an earlier journey in the same run carry their likes, blocks and reports along.
- Every step goes through `call.sh` (the user's action) or `sql.sh` (a second, read-only view of stored state). Give each a label that says what it shows: `feed-before`, `like`, `likes-row`.
- After an action, read back what the app would show next: it reloads the list or feed, or patches from the response.
- Leave the run's data as it is: cleanup throws the state away.

## Proof and skip reporting

- Proof is the action's `.http` file, plus a later `.http` or `.sql.txt` showing the resulting state.
- A refusal is proved by its status and message, plus the missing row.
- Report an unreachable step with the command you ran and the unmet precondition (see each file's Gotchas). Never count it as verified through another path.
- Screening, Clerk-side behavior (sign-in codes, Ban), webhooks and model calls are out of reach offline. Say so rather than implying them.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing what the user sees. Then come exactly four H2 sections, in this order: `Sub-features` (short IDs, one line each); `How to get to it (user POV)` (every in-app entry point, with the app file that calls the API); `Driving it with call.sh` (starts with `Preconditions:`, then labeled bullets pairing a user action with an exact command and its observable result); and `Gotchas`.

## Features

- [Discover feed](./feed.md): the signed-out and signed-in feed, paging, playing a game's page, and the version gate.
- [Like and save](./like-save.md): like/unlike with counts, save/unsave, the Saved tab, and the Me counters.
- [Comments](./comments.md): reading, posting with and without a Handle, and deleting as commenter or creator.
- [Report and Operator](./report-operator.md): reporting a game or comment, and the Operator's queue, Dismiss and Delete.
- [Block](./block.md): blocking from a game or comment, what disappears, the Blocked list, and unblocking.
- [Make (Drafts)](./make.md): starting a Draft, the Allowance, the Draft list, preview and publish from a seeded Revision.
