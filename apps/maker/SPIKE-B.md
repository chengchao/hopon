# Maker spike B: pi's own tools in the box

Spike A (`SPIKE.md`) ran pi-coding-agent with its built-in tools off and one custom `run_node` tool that executed model-written code in an E2B box. This spike adds `--mode ops`: pi's built-in tools (`read`, `bash`, `edit`, `write`, `find`, `ls`, plus a `grep`) stay pi's, but every file and process operation runs in the box through the tools' `operations` option. Skills and `AGENTS.md` load the way pi loads them, with no custom system prompt. pi stays on the Maker side with the model key.

```bash
pnpm -F maker chat "<prompt>" --model claude-sonnet-5-5 --mode ops --box e2b|local
pnpm -F maker eval --box e2b --mode ops|run_node --models claude-sonnet-5-5
pnpm -F maker spike:ops            # per-call overhead, needs E2B_API_KEY
pnpm -F maker template             # the template now ships helpers.js and playtest.js
```

Every run writes `out/<run>/system-prompt.md` next to the transcript, so the prompt the model saw is on disk.

## What pi 1.2.0 needed

| Need | What works | Notes |
| --- | --- | --- |
| Built-in tools executing remotely | `createReadToolDefinition(cwd, { operations })` and the same for bash, edit, write, find, ls (`src/ops.ts`) | `createCodingToolDefinitions` from the docs is **not exported** from the package index; the per-tool `create*ToolDefinition` functions are. |
| Make pi treat them as its own | Pass them as `customTools` with `noTools: "builtin"` | A custom tool with a built-in name replaces the built-in in pi's registry (`_refreshToolRegistry` sets custom tools after built-ins). The system prompt then lists them under `<tools>` with pi's own snippets and rules, and the `<skills>` section appears, because `declaredTools` contains `read`. No other option was needed. |
| `BashOperations.exec` | `sandbox.commands.run(cmd, { background: true, cwd, onStdout, onStderr, timeoutMs })`, then `handle.wait()`; abort signal → `handle.kill()` | A non-zero exit throws `CommandExitError`, which carries `exitCode`; a kill has none, reported as 137. pi passes its own `env` (the Maker's shell env, `getShellEnv()`) into `exec`: **ignore it**, or the Maker's keys reach the box. `exposeSessionEnvironment: false` drops the `PI_*` variables and the prompt line about them. |
| Read/Edit/Write | `files.read(path, { format: "bytes" })` → `Buffer`, `files.write`, `files.makeDir`, `files.exists` | `detectImageMimeType` is by extension; pi then resizes and attaches the PNG itself, so `read playtest.png` returns the screenshot as an image part. |
| Find/Ls | `find.operations.glob` runs `fd --glob` (falls back to `find -name`) in the box; `ls` uses `files.list` / `getInfo` | `ls` stats every entry; one `list()` answers them (cached). |
| Grep | **Not delegable.** `GrepOperations` only covers `isDirectory` and the context-line `readFile`; the tool always spawns `rg` on the Maker's machine | `src/ops.ts` registers its own `grep` tool that runs `rg -n` (or `grep -rn`) in the box. The local box has no grep tool; nothing in the eval used one. |
| Skills discovery | `.agents/skills/littlejs-api/SKILL.md` under `agent-home/`, loaded with `noSkills: true` + `additionalSkillPaths: [<home>/.agents/skills]` | pi's own discovery (`noSkills: false`) also walks `~/.agents/skills`, `~/.pi/agent/skills` and every ancestor directory's `.agents/skills`, which on a dev machine means the user's and this repo's skills. The explicit path keeps the native layout and nothing else. |
| `AGENTS.md` | `DefaultResourceLoader({ cwd: <home>, noContextFiles: false })`, no `systemPrompt` | `loadProjectContextFiles` walks every ancestor of `cwd`, so the home is copied to a temp dir per session (`cpSync(AGENT_HOME, home)`); under `apps/maker/` it would also pull in hopon's own `AGENTS.md`. |
| Two cwds | `createAgentSession({ cwd: "/workspace" })` for the tools and the `<cwd>` section; `DefaultResourceLoader({ cwd: home })` for context files and skills | The session cwd and the loader cwd are independent options. Tools resolve relative paths against `ctx.cwd`, the session's. |

### The routing trick for skills

The skill lives on the Maker's disk, the game in the box, and both are read by the same `read` tool. `ReadOperations.readFile` / `access` get an absolute path (pi resolves it against the session cwd first), so `createE2BTools(cwd, { localRoots: [home] })` routes any path under the copied agent home to `node:fs` and everything else to `sandbox.files`. The `<skills>` section lists the skill with its local absolute path and says "Use the read tool to load a skill's file", and in all 5 eval runs the model's first call was `read <home>/.agents/skills/littlejs-api/SKILL.md`. The box never holds a skill file. The same hook could route `/opt/hopon/*` the other way if the helpers ever move Maker-side.

### The system prompt

Verified in `out/<run>/system-prompt.md`: pi's preamble, `<tools>` listing read/bash/edit/write/find/ls with pi's snippets, `<rules>` with the edit guidelines, `<docs>`, then `<project_context>` with the whole `agent-home/AGENTS.md` inside `<project_instructions path=…>`, `<skills>` with `littlejs-api` and its location, and `<cwd>/workspace</cwd>`. Lines in pi's default prompt that mislead this task:

- The preamble: "You are an expert coding assistant operating inside pi, a coding agent harness." `AGENTS.md` says "You are the Maker"; the model follows AGENTS.md (every reply addressed the Creator), but the preamble wins the first line.
- `<docs>`: five lines pointing at pi's README, docs and examples under `node_modules/.pnpm/…` on the Maker's disk, "read only when the user asks about pi itself". Useless here, a few hundred tokens per request, and those paths are readable through our `read` routing only if they were under `localRoots` (they aren't, so a read would fail in the box).
- "Show file paths clearly when working with files" conflicts with "Never show code to the Creator"; two replies mentioned `game.ts` by name.
- "Use read to examine files instead of cat or sed" is fine, but nothing says "use write instead of heredocs": in 3 of 5 runs Sonnet wrote the game with `cat > game.ts <<'E'` in the same bash call as the playtest, which is cheaper (one tool round trip) but bypasses pi's write tool and its file-mutation queue.
- `<cwd>` is `/workspace`, which is right for the box. In `--box local` it is the temp dir.

The fix for all of these is `systemPrompt` on the loader, which replaces the preamble, tools, rules and docs sections and keeps project context, skills and cwd. That is what run_node mode does; this spike deliberately left the default on to see it.

## Helpers as scripts

`image/exec.js` is split: `image/helpers.js` exports `read`, `write`, `patch`, `playtest`, `minify`; `exec.js` is the run_node entry (globals + import); `image/playtest.js` is the CLI for ops mode (`node /opt/hopon/playtest.js [ms]`, prints the result JSON, writes `playtest.png`, exits 1 when not ok). The template copies all three. On the local box, pi's bash `spawnHook` rewrites `/opt/hopon` to `image/` and replaces the env with `HOME`, `PATH` and the browsers path, so the Maker's keys do not reach the child.

## Per-tool-call overhead (one E2B box, 10 cycles, laptop → E2B)

`pnpm -F maker spike:ops`, node warmed first:

| call | p50 | p90 | max |
| --- | --- | --- | --- |
| ops bash `true` | 64 ms | 69 ms | 76 ms |
| ops bash `node -e 0` | 87 ms | 95 ms | 111 ms |
| ops read (10 lines) | 124 ms | 131 ms | 138 ms |
| ops write | 126 ms | 132 ms | 154 ms |
| ops edit (read + write) | 184 ms | 224 ms | 225 ms |
| ops ls (exists + stat + list) | 195 ms | 201 ms | 205 ms |
| run_node empty module (write file + exec + changed-files read) | 230 ms | 252 ms | 474 ms |
| run_node `read` + log | 233 ms | 242 ms | 243 ms |

One E2B RPC is about 60 ms; pi's read and write cost two (`exists` then the transfer), edit three, ls three. A run_node call is four RPCs plus a node start. Per call, ops mode is cheaper. Per game, that doesn't matter: the playtest itself is 4–11 s and the model turns are 5–10 s each.

## Eval: Sonnet 5.5, E2B box, 5 prompts, both modes

Same prompts and scoring as `SPIKE.md` ("green" = playtest ok: no console errors and the clock ran). "Runs" = run_node calls, or bash calls in ops mode. `$` is the gateway's cost at Anthropic list prices with caching.

| mode | prompt | 1st green | final green | runs | tool calls | turns | in / out tokens | $ | s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run_node | moon cat | yes | yes | 1 | 2 | 3 | 19,374 / 2,078 | 0.048 | 29 |
| run_node | fruit catcher | yes | yes | 1 | 2 | 3 | 19,437 / 2,094 | 0.049 | 25 |
| run_node | ocean memory | yes | yes | 1 | 2 | 3 | 20,394 / 3,074 | 0.061 | 33 |
| run_node | neon snake | yes | yes | 1 | 2 | 3 | 19,111 / 1,710 | 0.044 | 24 |
| run_node | gnome whack | yes | yes | 1 | 2 | 3 | 19,091 / 1,732 | 0.044 | 27 |
| ops | moon cat | yes | yes | 2 | 5 | 5 | 54,667 / 2,207 | 0.060 | 32 |
| ops | fruit catcher | yes | yes | 2 | 5 | 5 | 54,174 / 2,075 | 0.058 | 27 |
| ops | ocean memory | yes | yes | 1 | 4 | 4 | 44,295 / 3,643 | 0.076 | 36 |
| ops | neon snake | yes | yes | 2 | 4 | 4 | 41,447 / 2,145 | 0.057 | 26 |
| ops | gnome whack | yes | yes | 2 | 5 | 4 | 42,397 / 2,472 | 0.061 | 31 |

| mode | 1st green | median turns | median tool calls | median $ / game | median s / game | cache write / game |
| --- | --- | --- | --- | --- | --- | --- |
| run_node | 5/5 | 3 | 2 | 0.048 | 27 | ~10.3k tokens |
| ops | 5/5 | 4 | 5 | 0.060 | 31 | ~11.8k tokens |

Where the extra $0.012 and 4 s come from: ops mode needs one or two more model turns per game. The screenshot is not attached to the playtest result (bash output is text), so the model spends a turn on `read playtest.png`; and in 2 of 5 runs it spent another on `ls` after a failed read (below). Each extra turn re-reads the ~11k-token cached context ($0.003) and costs 3–5 s. pi's default prompt adds about 1.4k tokens to the cache write. The ops games themselves: same tool pattern every time (read skill → write or heredoc → `node /opt/hopon/playtest.js` → read png → reply), all green on the first playtest, output tokens within noise of run_node.

`--box local --mode ops` (snake, Sonnet): green in 25 s, $0.059, read 13 ms, bash 8.0 s; the same three tool calls, with pi's own local operations and no E2B.

## Surprises

- **Read right after bash: "not found", twice.** In 2 of 5 ops runs, `read playtest.png` immediately after the bash call that produced it got a real `NotFound` from E2B's `stat`; the model ran `ls` (which listed it) and read it fine. Not reproduced in 9 scripted write-then-read and playtest-then-read attempts. `access` now retries once after 300 ms. Worth watching in phase 2; if it recurs, make the playtest tool return the image itself.
- **Sonnet prefers heredocs to `write`.** 3 of 5 runs did `cat > game.ts <<'E' … E; node /opt/hopon/playtest.js` in one bash call, saving a turn. pi's rules only say "use write for new files or complete rewrites", and the model trades the rule for the round trip. Fine for a spike; for the Maker it means revisions come through bash as well as `edit`, so "what changed this turn" has to come from the workspace, not from the tool calls.
- **grep is not remote-capable** in 1.2.0 (its `operations` cover only the context reads); the other six are.
- **`createCodingToolDefinitions` is in the typings' index but not exported**; the per-tool factories are.
- **pi forwards the Maker's environment to `BashOperations.exec`** as `env`. The E2B operations ignore it; the local-box spawn hook replaces it. A remote-operations implementation that spreads `env` into the command would leak every key.
- **Two cwds** (session vs resource loader) is what makes "skills here, files there" work, and nothing in the docs says they're independent.
- Refactoring the skill into `agent-home/` broke run_node mode's `load_skill` for one eval (the tool said "no skill named littlejs-api"); Sonnet still made 5/5 green games with no skill at all, at $0.022–0.030 and 2–3 runs each. Rerun with the skill: the table above. The no-skill transcripts are in `out/`, not analysed.

## Recommendation

**Use ops mode for the Maker, with a custom `systemPrompt`.** Trade-offs stated plainly:

For ops mode:

- The model gets pi's real tools: `read` with images, `edit` with exact-match and multi-edit, `write`, `bash`, and pi keeps improving them. Skills and `AGENTS.md` load natively, so adding a skill is adding a folder, and pi's system prompt tells the model to read it. No `load_skill`, no `run_node` prompt text to maintain.
- Per tool call it is faster (60–130 ms vs 230 ms) and each operation is a plain RPC we control: the box runs only what the model typed, no `exec.js` layer, and `env` never leaves the Maker.
- Revisions arrive as file edits, which is what the Maker's snapshot per turn wants anyway.

Against, and what to do about each:

- **+$0.012 and +4 s per game** (25% and 15%) from extra turns. Half of it is the screenshot read. Give the playtest a tool of its own (a `playtest` custom tool that runs the script via the same `exec` and attaches `playtest.png`), and the ops pattern becomes read skill → write → playtest → reply: the same 3 turns as run_node. The other half is pi's default prompt (`<docs>` etc.), removed by `systemPrompt`.
- **Heredocs through bash** bypass the write tool. Acceptable; or tell the prompt "write game.ts with the write tool" more firmly, or restrict bash to the helper scripts for v1 (an allowlist in `exec`).
- **The flaky `exists`** after a write from a process. Retry in place; the `playtest` tool above also sidesteps the common case.
- **grep** needs our own tool until pi's takes operations; the Maker's workspace is a few files, so `grep` can also be left out.
- More surface: six operations objects instead of one tool. `src/ops.ts` is 220 lines, half of it the `ls`/`find` plumbing the Maker may never use. Register only read, bash, edit, write (and the playtest tool) in phase 2.

Keep run_node mode as the fallback: it is 3 turns by construction, the screenshot rides on the result, and it works the same on any box with node. If phase 2 finds pi's tool set changing under us (1.0.4 → 1.3.0 in ten days), run_node is the stable floor.
