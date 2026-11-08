# 5. The main agent owns the game and the sub agent writes it

## Status

Proposed. Changes the Maker of ADR 0003 in two ways: who does what, and how many Durable Objects it takes. It also raises the Allowance of ADR 0004. The rule that the agent writing code never reads the Creator's words stays.

The Talker becomes the **main agent** and the Coder becomes the **sub agent**. Both run inside one Durable Object, `Maker`, the name Creators already know. The box becomes the **sandbox**.

## Context

ADR 0003 splits the Maker into a Talker and a Coder, but the Coder decides most of what makes a game good. The Talker writes a `brief`. The Coder then picks the engine (`agent-home/AGENTS.md`), plays the game and decides when it is done. The Talker receives one sentence and has no say.

The owner wants one agent to own the game: it plans, reviews, verifies and delegates. The other agent writes code, and checks that code against the success criteria it was given. The owner also made these calls:

- A turn may take up to 5 minutes. ADR 0003's "a chat can't wait minutes" no longer holds.
- The main agent runs on Claude Opus 5.5.
- The Allowance rises to pay for that.
- No new custom tools or tool parameters. What an agent should do belongs in a skill or a prompt.
- A game reaches the Creator only when the main agent's turn ends normally. A turn that fails, times out or stops changes nothing, even if that loses a green build.
- The main agent is told to check every build, and the gate measures whether it does. Code doesn't force it.
- Existing chats don't need to survive this change.

These facts shape the design:

- **Both objects already run the same stack.** The Talker and `DraftCoder` each run pi-durable through PiHarness, one object per Draft, in one Worker. Between them sit a job route, an NDJSON stream, a ping, a cancel route and a copy of the job's state.
- **pi-durable has task-owned child conversations.** A child has its own model, tools, prompt and hooks. A probe ran a main and a sub agent in one Harness, with pi-durable 1.4.0's faux provider and SQLite on Node, not PiHarness on workerd. The sub agent's requests held its own model, tools and prompt and never the Creator's words. The main agent's snapshot held none of the sub agent's output. Stop ended the child at once. Closing and reopening mid-build resumed the same child, with no repeated model call. Two adversarial prototypes then held all of this on workerd and PiHarness, with a fake model, and one ran a real Container on an `Agent` class under local `wrangler dev`.
- **The transcript goes to the app.** `talker.ts` sends pi's snapshot as it stands on every connect. Two screenshots as ordinary tool output took a one-review turn from 5.7 KB to 47.3 KB (measured with the faux provider and `MemoryStorage`).
- **The main conversation outlives a build.** It lasts for the Draft, so what it reads stays in later requests unless something removes it.
- **`build` is the app's signal.** `maker-chat.ts` shows the status row for a running `build` and draws a "tap to play" card for each non-error `build` result. It ignores every other tool.
- **A Revision goes live when it is written.** The preview route serves the highest Revision in R2, and Play offers "New version · Reload" as soon as one appears (`play.tsx`). Hiding a card isn't enough to hold a game back.

Two defects turned up on `main`. Neither depends on this decision.

- **One build per turn isn't enforced.** `talker-build.ts` keys its guard on `live.run.taskId`, which changes every tool round. Three sequential `build` calls read 9, 14 and 18 while `live.run.inputs` stayed `[8]` (measured the same way, then reproduced on PiHarness in `talker.test.js`), so only two calls in one model message are refused.
- **A game can ship with stale code.** Only `playtest` emits `game.js` (`image/helpers.js`), and `failure` in `job.ts` looks only at the last playtest, so an `edit` after a green playtest writes a new `game.ts` and the old `game.js` into the Revision (reproduced in `coder.test.js` with a fake box).

## Decision

**One Durable Object runs two agents. The main agent designs, delegates with `build` and checks each result in the sandbox. The sub agent writes the code and checks it against the brief's success criteria. The harness, which is our code and not a model, enforces what must always hold.**

### One class, two agents

`Maker` replaces `Talker` and `DraftCoder`, one per Draft. It extends `Agent`, holds the app's sockets, owns the Container through `ctx.container`, and opens one Harness.

|  | Main agent | Sub agent |
| --- | --- | --- |
| Conversation | The root, for the life of the Draft | A child owned by a `build` call, new for each build |
| Model | `claude-opus-5-5` | `claude-haiku-5-5` |
| Tools | `build`, pi's `read` and `bash`, `activate_skill` | pi's `read`, `write`, `edit` and `bash`, `playtest`, `activate_skill` |
| Reads the Creator's words | Yes | No, only the brief |

The two agents differ in what they do and what they can see, and pi's per-conversation configuration carries all of that. Each is one pi extension with its own prompt and hooks, so a hook runs only for its own agent.

`build` creates the child, submits the job's prompt, waits for it and passes its step labels to the status row. Stop aborts the child through pi. `build` sets `executionMode: "sequential"`, because pi otherwise runs a message's tool calls in parallel, and two builds or a `build` and a `bash` would collide in the one sandbox. The job prompt says "change the game" whenever a pending build or a Revision exists, since `revision === 0` no longer means a new game. The job route, the NDJSON stream, the ping and the cancel route all go, and so does `session.reset()`.

`MAKER_TALKER_MODEL` and `MAKER_CODER_MODEL` become `MAKER_MAIN_MODEL` and `MAKER_SUB_MODEL`. The tool name `build` stays, because the app reads it.

### The sandbox

Both agents get the sandbox through the Harness's `env`, so they see the same files. The code stays apart from the agents as a module and Effect service, `AgentSandbox`, renamed from `coder-box.ts` and `Box`. The contract test's fake still replaces its Layer.

The sandbox restores itself from R2 after a restart, a failed build or a discarded one: the pending build if there is one, otherwise the current Revision. So the main agent always reads and plays the game that will ship or the game the Creator has. A running job's source is the same files.

A sandbox that restarts during a job loses what the sub agent wrote, and the harness could then pass the old game. `AgentSandbox` keeps a start count. The harness compares it with the count at the job's start and, if it changed, tells the sub agent to write its changes again.

Its isolation stays as ADR 0003 has it: no secrets, no internet, one per Draft. It is now the only barrier between the Creator's words and a shell, because the main agent reads those words and holds `bash`. The Creator can reach only their own Draft, and no code path brings another Creator's code into a Draft.

### The brief carries the engine and the success criteria

`build`'s parameters don't change. The brief is the sub agent's prompt, so the main agent's prompt tells it to write these in the brief:

```text
Engine: littlejs
(the design)
Done when:
- Tapping the left half moves the basket left.
- The game ends after 3 misses.
```

Each criterion is something the sub agent can observe. No code parses the brief. `AGENTS.md` loses its engine rules and gains the rule to meet and report the criteria.

### The sub agent checks its own work

The sub agent writes the game, plays it with `playtest`, looks at the screenshots and fixes what it finds, as it does today. It finishes when the game meets every criterion or it can't get further, and its final answer says for each criterion whether it was met and what it saw.

That report is the author's claim. It tells the main agent where to look, and it doesn't make a build succeed or fail. A build with an unmet criterion still returns to the main agent, which decides what to do next.

### The harness checks every build

Each time the sub agent stops, pi calls its `onYield` hook, and the hook runs these steps:

1. Render `music.mjs` to `music.js`, if the game has music.
2. Read the source back from the sandbox into memory.
3. End every process left in the sandbox, and clear the workspace and the home directory. A background process or an edited `~/.bash_profile` that a model left behind can't touch the result.
4. Write the source from step 2 back, so the sandbox holds only the game.
5. Typecheck `game.ts`.
6. Emit `game.js` from that `game.ts`, so the stored `game.js` always comes from the stored `game.ts`.
7. Play the game with the sub agent's last playtest inputs.
8. Play it again with the fixed random script, the same taps every time, because a model's inputs can miss a crash.

These commands run from `argv` with full paths such as `/usr/local/bin/node`, with no shell. Today's `bash -lc` runs `~/.bash_profile`, and a prototype on the real image passed a game that throws by planting a fake `node` there. Each command takes the turn's abort signal, so Stop and the timer don't wait for it.

Any of these fails the check: a type error, a console error, a frozen clock, identical start and end screenshots, or a failed music render. The hook returns `continue` with the errors, and the sub agent gets them as a new message and goes on, at most 3 times per build. The main agent doesn't wake. A build still red after that fails, and `build` returns the failure to the main agent.

This step runs whatever a model decides, and no model can pass it by claiming success. The pending build holds exactly the bytes it played. It keeps #122's rule that a game that doesn't run never becomes a Revision, and it closes the stale `game.js` defect. It answers only "does the game run", and the two agents answer whether it is the right game.

### The main agent verifies with a skill

`verify-game` lives with the other skills in `agent-home/.agents/skills/`, in a manifest only the main agent sees. `skills()` always names its extension `agents.skills` and a second install replaces the first, so each agent's is renamed. The main agent loads it after a successful `build`. It says to:

1. Read the sub agent's report, but don't rely on it. Read `game.ts` against the design and the criteria, and find the coordinates of the controls.
2. Run `node /opt/hopon/playtest.js '{"inputs":[...],"ms":...}'` with inputs written for those controls. Runs at different lengths show different moments.
3. Read the result, then `playtest-start.png` and `playtest-end.png`.
4. If the game meets the design, reply to the Creator. If it doesn't, call `build` with what is wrong, what it should do, new criteria, and "Keep everything else."
5. Write nothing to the Creator during the check, and change code only through `build`.

A skill can be skipped. The `build` result says to load it and play the game before replying, and the gate counts how often the main agent does. A turn that skips the check still commits, and that game has passed the sub agent's check and the harness's. So this rule means the main agent is told to check and is measured on it. Code can't tell whether a model looked at what it ran, so no code stands behind it.

The main agent's `read` and `bash` work on every turn, because reading the code first makes a change brief more exact. The prompt says to use them in chat only when the Creator's request needs them.

The main agent can't ship its own edits, even though `bash` can write and the sandbox can't stop it, since `exec`'s `user` restricts nothing under the `durable_object` policy. Each job and each harness check starts by ending every process and rewriting the workspace, and a Revision holds only what the check played.

### A build takes effect when the turn ends

A successful `build` writes its full file set to `pending/<draftId>/` in R2, outside `drafts/<id>/` because `currentRevision` reads every name there as a number. A later `build` in the turn starts from those files.

How the turn ends decides what happens to the pending build:

| Ending | What happens |
| --- | --- |
| The main agent gives its final reply | The pending build becomes the next Revision, in the main agent's `onYield`, before the reply is saved |
| The Creator presses Stop, the turn's time runs out, the tool limit is hit, or a model call fails | The pending build is deleted, so "Your game hasn't changed" is true, in old apps too |

Once a commit starts, Stop and the timer wait for it, so the turn ends normally and the app's message stays true. The commit is safe to repeat, keyed on the `build` call's id. A pending build left by a crash is deleted when the object restarts unless its commit had started, and `busy` answers true while one exists, so Publish waits.

A commit that fails ends the turn as failed and deletes the pending build, since pi swallows an `onYield` error and would otherwise report success with no Revision. A reply already streamed stays on screen in that rare case.

Deleting a Draft removes `pending/<draftId>/` too. `Maker`'s delete action destroys the Container before it destroys itself, and `killBox` goes, because calling the object again after `destroy()` made Delete and Publish return 500 on a real Container.

The main agent has no way to reject a green build outright. If it runs out of builds while unhappy, the last green build still becomes a Revision and it says so plainly. That is no worse than today, where every green build ships.

### What reaches the app

`maker-wire.ts`, a pure function on every snapshot and batch, removes `read` and `bash` calls and output, review text, images, thinking and the `build` brief. It also holds back each `build` result until its call id is in the list of committed builds, so a card appears only for a real Revision. A pending result from a stopped turn never draws one.

The status row keeps running during the check, which takes one small change in `maker-chat.ts`, sent by EAS Update. An app without the update shows no status row during the check and still works.

### What reaches the model

A `beforeRequest` hook removes `read` and `bash` output and images from earlier builds in each request. pi uses the hook's messages for that request and doesn't save them. It also marks a `build` result that was discarded, so the main agent doesn't believe the game changed, and it tells a new chat the Draft's current title and description, so a later `build` doesn't rename the game.

### The budgets

| Budget | Value | Enforced by |
| --- | --- | --- |
| Any turn | 300 s from its start, music included | An abort timer on `Maker`, armed at `run_start` and re-armed on restart |
| A sub agent job | Ends 30 s before the turn does | A timer on `Maker` |
| Starting another `build` | At least 60 s left | `build` |
| Builds per turn | 3, keyed on `live.run.inputs[0]` | `build` |
| Sub agent steps | 20 per job | The sub agent's `beforeTool` |
| Harness repairs | 3 per build | The sub agent's `onYield` |
| Main agent tool calls | 20 per turn; the 21st ends the turn | The main agent's `beforeTool` |
| One `bash` call | The time left, at most 120 s | The main agent's `beforeTool` |
| Allowance | 40,000,000 hopon tokens a week, checked at the turn's start and at each `build` | `build` and the API |

The main agent's tool limit also bounds sandbox time, which ADR 0004 doesn't charge for, and how far a turn can overshoot the Allowance.

### The model and the Allowance

The main agent's model goes through the gateway's `/anthropic` route. Only Sonnet has been tested on that route, so one real call on a Preview checks it, images included.

Opus 5.5 costs 40 times Haiku 5.5: $4 and $20 a million tokens against $0.10 and $0.50 (pi-ai's catalog). Without caching, and reading the 10-28 report's $0.056 as the Talker's total over 67 builds, the main agent's share of a build rises from about $0.001 to about $0.033. A check adds about $0.10 (a guess). That makes a build about 1.5 million hopon tokens, against 110,000 today.

`MAKER_WEEKLY_TOKENS` rises from 3,000,000 to 40,000,000, which keeps about 25 builds a week and costs about $4 a week for a Creator who uses all of it, against $0.30 today. The number comes from a guess, so the treatment sweep sets the final value.

### The gate compares three arms

A sweep of 72 builds on a Preview, the e2e of ADR 0003, runs for each arm in the same week, because Haiku's thinking has already moved the baseline once (#179).

| Arm | What it is |
| --- | --- |
| Baseline | `main` as it stands |
| Control | One `Maker` class, success criteria, the harness check and Opus, but no `read`, `bash` or `verify-game` on the main agent |
| Treatment | This ADR |

| Measure                                     | Bar                          |
| ------------------------------------------- | ---------------------------- |
| Judge pass, of judged builds                | At least 85%                 |
| Builds that pass every check                | At least the baseline's      |
| Builds that end in a Revision               | At least the baseline's      |
| p95 s                                       | At most 300                  |
| Hopon tokens per build                      | Reported; sets the Allowance |
| Snapshot bytes per build turn               | At most 6 KB, no images      |
| Main agent chats, reply limits              | No worse than the baseline's |
| Builds where the main agent played the game | At least 90%                 |

The eval also reports the median, how often a second `build` fires, how often the sub agent's report and the main agent's check disagree, and how many builds fail on the deadline. A sweep this size can catch a regression but can't prove a small gain: 88% of 67 builds has an interval of about 8 points either way. So the owner also blind-scores every build the main agent sent back, and the count of right and wrong rejections decides whether the check stays. By the owner's verdicts, 3 of the 58 judged games on 2026-10-28 were bad. That is a lower bound, because the blind set held only the judge's failures, but it does mean review has little room to show a gain.

If the main agent's check shows no gain for its cost, the recommendation is to ship the control arm. The owner decides on the results.

### The order of delivery

Each step ends in a check. Step 2 merges to `main` alone. Steps 3 to 7 stay on an integration branch until the gate passes, as #171 did.

1. This ADR. Check: the owner's review.
2. Fix the two defects on `main`, each test failing first. The stale `game.js` fix is `finishJob` playing the workspace again when it changed after the last playtest, because emitting alone would ship code nothing played.
3. `Maker`, with behavior unchanged apart from the names: one class, the Container on it, the sub agent as a child conversation, both container configs, the delete path, the fake sandbox in the tests. Check: the worker tests, `smoke:coder`, Delete and Publish on a real Container, and on a Preview a kill mid-build and a turn after the object hibernates with the Container still running.
4. The control arm: the brief's criteria, the sub agent's report, the harness check, Opus and the Allowance. Check: tests including a planted `~/.bash_profile`, a background process and a game that crashes only under random taps; one real Opus call on a Preview; then the sweep.
5. The pending build, its commit and `maker-wire.ts`, with one `build` per turn. Check: tests with a kill before and after each commit, Stop during a commit, a failed commit, a timeout, Delete with a pending build, and recorded frames through the real `maker-chat.ts` reducer.
6. `read` and `bash`, `verify-game`, up to 3 builds, the `beforeRequest` hook and the main agent's limits. Check: tests including two `build` calls in one message and a `build` with a `bash`, the snapshot bar, and one real review on a Preview.
7. The treatment sweep, then the owner's blind score and decision.
8. The switch to production, in two deploys, because Cloudflare refuses to delete a class in the deploy that moves its binding (code 10061): the first adds `Maker`, the second deletes `Talker` and `DraftCoder`. The owner confirms the second, since it can't be undone.

## Considered

- **Keep two classes under new names.** Keeps ADR 0003's separation and needs less change, but the two objects differ only in configuration pi already holds per conversation, and the job route between them does nothing a child conversation doesn't.
- **A separate `AgentSandbox` Durable Object.** The first answer to sharing the sandbox, and the fallback if a Container on `Maker` doesn't hibernate well. With one class it adds an RPC hop and a third object per Draft for no gain, since the module already keeps the code apart.
- **`engine` and `successCriteria` as `build` parameters.** Structured, but no code reads them. They belong in the prompt.
- **`delegate`, `revise` and `accept` tools.** They let the main agent reject a build, but they add three tools and require a layer that renames them to `build` for the app. Holding the Revision until the turn ends gives the same final say without them, except for outright rejection.
- **The sub agent loses `bash` and `playtest` and only writes code.** Ownership looks cleaner, but the sub agent couldn't check its success criteria, and every visual fix it makes at low effort today would cost a main agent review and a new `build`.
- **The harness produces evidence and the main agent rules on it, seeing no code.** It spends fewer tokens, but two stills and some numbers can't tell the main agent whether the design was built. It assumed a tight clock that the owner has removed.
- **The Revision and card appear as soon as `build` succeeds.** No held state and an earlier first play, but the Creator can play a game the main agent hasn't checked.
- **Hide the card but write the Revision.** The preview route and Play's reload pill would still show the unchecked game.
- **Commit the pending build when the turn fails or times out.** A green game isn't lost, but the Creator gets a game the main agent never finished checking, next to a message saying nothing changed.
- **Remind the main agent, then discard, if it replies without playing the game.** Stronger on paper, but its "done" has already streamed, a discard then contradicts it, and code can only see that `playtest.js` ran, not that the model read the result. The next step if the gate's 90% fails.
- **Keep existing chats with `renamed_classes`.** The owner doesn't need them, and a new class avoids moving a Container application in place, which ADR 0003's migration found Cloudflare refuses.

## Consequences

- Every Draft's chat is lost when `Talker` is deleted. Revisions in R2 and rows in D1 stay, so a Draft keeps its game and starts a new chat, and the main agent can read the game's code.
- A failure late in a turn throws away a green build, and the Creator has to try again and pay for it again.
- Creators wait longer on builds the main agent sends back, up to 5 minutes, and see nothing playable until the turn ends. The first play comes later on every build.
- `Maker` holds the sockets, both agents and the Container in one object. A crash in a build also drops the Creator's socket, which the app already reconnects. Whether a Container on an `Agent` object hibernates as the Talker does today is unknown, and step 3 tests it before anything else builds on it.
- A game is checked three ways: the sub agent against its criteria, the harness for whether it runs, and the main agent against the design. The first and third overlap on purpose, because an author's report isn't independent. The gate shows whether that overlap earns its cost.
- Costs rise about 13 times per build by the estimate above, and only the check's share depends on the gate. The prepaid AI Gateway credits stay the backstop (ADR 0004).
- The sub agent still never reads the Creator's words, but that rule no longer keeps those words away from a shell. The sandbox's isolation does.
- Model-written code and pixels now reach the main agent and can carry instructions. Only the Creator can steer them, and that Creator already talks to the main agent.
- The main agent's check rests on a model following a skill, and the engine and criteria rest on it following its prompt. A turn can skip the check, and the gate is what catches that. The harness's check can't be skipped.
- The main agent holds more context, which may lower chat quality, and its chats already pass only 69%.
- A build in flight at the switch is lost. Traffic is small enough to accept that (a guess).
- ADR 0003 and the eval's results keep the old names as history.

## Revisit when

- A Container on `Maker` costs more or hibernates worse than two objects did.
- The blind score shows the main agent's rejections are mostly wrong, or its chats fall.
- The main agent plays the game in under 90% of builds, which calls for the reminder under "Considered".
- The sweep's cost per build differs much from this ADR's guess, which changes the Allowance.
- A cheaper model reviews as well, since Opus is the largest part of a build's cost.
- The harness can record a video of play, because the main agent could then judge how a game plays.
