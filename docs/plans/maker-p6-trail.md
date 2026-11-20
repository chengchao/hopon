# P6 trail: a message has no time limit

The decisions behind P6a, in order. Each names what it changed and its evidence, marked measured, inferred or guess. The decision itself is ADR 0009. P6b (progress states in the app, the app's localization) is the next PR.

## The incident

- **A finished game was thrown away by the clock.** A production Draft asked for a big sailing and trading game. The agent read make-game and three guides, wrote the design and the game, got a green playtest, rendered music, fixed a failing test until all 3 passed, and called `build`. The `beforeTool` hook refused it: "Past the 300 s deadline. Tell the Creator you couldn't make it work this time." The reply asked the Creator to say it more simply. About 6 minutes, $0.46, 13 model calls, under the step limit (measured, from the Draft's snapshot, kept outside the repo).
- **Where the time went.** About 7 s per typecheck, 10 to 17 s of wall time per test, about 33 s per playtest, plus the music. Box costs, not a loop (measured, same snapshot).

## Build

- **Branch.** `claude/p6a-no-run-deadline` from `origin/main` at `27138ba` (P5 merged).
- **Where the deadline lived.** `DEADLINE_MS = 300_000` in `apps/maker/src/job.ts`. `RunState.deadlineAt` in `apps/worker/src/maker.ts`, set at a run's first tool call. The `limits` hook refused any call past it with tool-results.md's `deadline` section. `MAKER_BUILD_ABORT_S` (330 s) aborted the run 30 s later. maker.md told the agent the minutes and to say it "couldn't finish it this time" (all read in source).
- **The limits became one pure function.** `apps/worker/src/limits.ts`'s `checkLimits(state, building, now)` returns the next counts and, past a limit, which limit and what the agent does next (`kept`, `last-build`, `give-up`). It replaced three `if`s in the hook, and it is unit tested without workerd (`limits.test.ts`, 5 cases). `RunState` extends its `RunCounts`, with `startedAt` in place of `deadlineAt`.
- **Publish if green, past any limit but the build limit.** A run past the 20-minute ceiling or the step limit that has published nothing may call `build` once (`finalBuild`). The refusal tells the agent to call it if the game is finished and its last playtest passed. The brief asked for this at the ceiling. The step limit got it too, since a run that stops on steps with a green, unpublished game is the same failure as the incident. The harness doesn't publish on its own: `build` needs the title, description, kind and music that only the agent knows, and its check is the "checks pass" test.
- **The per-call timeout existed at 120 s.** Every box command already ran under `/usr/bin/timeout --kill-after=5 120` (read in source). Two gaps: a timed-out playtest or check reported only `exit 124`, and pi's bash with no `timeout` of its own reported "Command timed out after undefined seconds", since pi formats the agent's argument (read in `pi-durable/dist/tools/bash.js`). Now `COMMAND_TIMEOUT_S` is 180 s. `jobBox` turns exit 124 into "timed out after 180 s". The hook sets bash's `timeout` to at most 180 s (`beforeTool`'s `arguments`), so its error names the seconds. Only 124 counts as a timeout in `jobBox`: 137 is also an OOM kill.
- **A crashed playtest no longer fails on its screenshots.** The playtest tool read both PNGs whenever there were no type errors, so a timed-out playtest that left none threw a file error instead of returning the timeout. It now returns no images then (found by the new worker test).
- **Abort timer 1500 s.** 5 minutes past the ceiling, room for the last `build`. It only matters for a model call that never returns.

## The numbers

- **Steps 30 (from 20).** Measured in the incident's snapshot: from the 7th call on, a call read about 40K to 56K cached tokens for $0.012 to $0.04, the dearer ones writing a file. So 10 more steps cost about $0.15 to $0.40 at worst, against the $8 weekly Allowance. With the deadline gone, 20 steps is the next limit a big game hits: 4 of the incident's 13 calls were reading docs (inferred).
- **Builds 4, Allowance unchanged.** Neither was binding in the incident (measured). The Allowance bounds a Creator's week and a run's overshoot.
- **Ceiling 20 minutes.** The operator's figure. 30 steps at the incident's pace (about 28 s per call, measured) is about 14 minutes, plus 4 builds of a minute or so (guess), so a normal run stays under it.
- **Command timeout 180 s.** The slowest single call measured was a 33 s playtest. make-game allows at most 4 tests, 4 × 17 s ≈ 70 s plus the build. 180 s leaves room and costs a hung call 3 of the 20 minutes.

## What the agent is told

- **No fixed Creator sentence in the harness.** `BUSY` and `USED_UP` went from `prompts.ts`. `used-up`, `busy`, `give-up`, `kept`, `last-build`, `steps`, `builds` and `ceiling` give facts and instructions, and the agent replies in the Creator's language (maker.md already says so). maker.md lost "suggest trying again, maybe simpler" and "word for word". It says once never to name a limit, apologise for one, or ask the Creator to simplify or reword. make-game's port step points at the refusal instead of scripting the reply. The skill fingerprint is v13.
- **A test guards it.** `prompts.test.ts` fails if maker.md or tool-results.md says "Tell the Creator: \"", "word for word", "maybe simpler", "more simply", "couldn't make it work", "deadline", or a number of seconds.
- **The ceiling isn't in maker.md.** The agent shouldn't plan around a safety net. The step and build limits stay.

## Tests

- **Worker (`test/maker.test.js`, real Maker on workerd, fake model and box).** `age/<s>` moves the run's start back. "time": a run aged 6 minutes writes, builds and playtests with no call refused. Aged 21 minutes, the write is refused with the last-build text, the build publishes, and the next call is refused with the Revision. A broken game gets its one build, fails the check, and the next call is refused with nothing published. "limits": 31 writes, then the build still publishes, then the 5th build of the next message is refused with the 4th Revision. "a hung call": `hangplay` and `sleep 9999` return exit 124 as `timeout` would. The agent sees "Command timed out after 180 seconds" and "playtest crashed: exit 124: timed out after 180 s", the box ran `timeout --kill-after=5 180 bash -lc sleep 9999` though bash asked for 9,999 s, and the run publishes.
- **The "time" test fails under a 5-minute limit.** With `RUN_CEILING_MS` set to 5 minutes, it fails on "no call refused" at the 6-minute run (measured, then reverted).
- **The allowance test starts from a full week.** The new tests' model calls spent the shared test user's 200,000 tokens before it ran, so its first Draft got 429 (measured). It now moves the week first, and splits its 198,000-token spend into two calls.
- **`pnpm check` green** (measured): maker 38, worker 119, mobile 20, model-fetch 5. The box image didn't change, so no image was built.

## The eval

- **`big-voyage`.** One English message for a whole sailing and trading game in the age-of-exploration genre, with no product names. `"publishes": true` makes its turn pass only if a `build` published a Revision.
- **Limit talk fails any chat.** `limitTalk` matches the harness's limit words and the old give-up ("couldn't make it work", "something simpler", "say it more simply", "deadline", "step limit"). "Time limit" and "ceiling" alone are game words and don't count (unit tested).
- **The summary still computes.** `report.ts` splits failed builds by the limit their refusal names, with old sweeps' "deadline" kept. `talkerStats` and `coderStats` are tested on records of the new shape. The e2e turn wait is the ceiling plus 10 minutes, up from 10 minutes.
- **Not run.** The e2e sweep is the operator's.
