# Maker phase-0 spike

Throwaway code in `apps/maker` that answers four questions before phase 1. Plan: `~/.claude/plans/there-are-models-that-iridescent-wigderson.md`. Run things with:

```bash
pnpm -F maker spike:sdk --model claude-haiku-5-5   # Q1, needs a model key
pnpm -F maker spike:box --cycles 20                # Q2 + the skill's examples, needs E2B_API_KEY
pnpm -F maker template                             # rebuild the E2B template from image/
pnpm -F maker chat "<prompt>" --model <id> --box local|e2b [--no-images] [--steer "<text>"]
pnpm -F maker eval [--box e2b] [--models a,b]      # Q4: 5 prompts × models, prints the table
```

Keys live in `apps/maker/.env` (see `.env.example`): one Cloudflare AI Gateway token for all models, plus E2B.

## 1. pi-coding-agent SDK

Version 1.2.0 (1.3.0 shipped on the day of the spike; pnpm's minimum release age holds it back). Wrapper: `src/maker.ts`.

**It does what the plan needs**, with these differences from the docs and the plan:

| Plan / docs say | Reality in 1.2.0 |
| --- | --- |
| `noTools: true` | `noTools` is `"all" \| "builtin"`. `"all"` also turns off custom tools; `"builtin"` is the one we want. |
| Skills come from the `resourceLoader` | They load (a standalone `skills/littlejs-api.md` with frontmatter works through `noSkills: true` + `additionalSkillPaths`), but `buildSystemPromptSections` drops the skills list when neither `read` nor `bash` is active, so **the model never sees them**. We add our own `load_skill(name)` tool that lists the skills in its description and returns the Markdown. |
| `importFromJsonl()` restores a session | It is on `AgentSessionRuntime`, not `AgentSession`, takes a file path, copies the file into the session dir and reopens it as a persisted session: it writes files. The in-memory equivalent is `SessionManager.inMemory(cwd, undefined, parseSessionEntries(jsonl))`. `session.exportToJsonl(path)` also only writes a file; the string form is `[header, ...getEntries()]` as JSON lines (`exportJsonl` in `maker.ts`). |
| Default system prompt | Talks about pi's docs and file tools. Replace it with `DefaultResourceLoader({ systemPrompt })`; what's left is our prompt plus a `<cwd>` section (an empty temp dir). |
| Credentials | `ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null })` then `setRuntimeApiKey()`: no `auth.json` / `models.json`. `AuthStorage.inMemory` from the docs isn't exported from the package index. |
| `getModel` from pi-ai | Deprecated; use `getBuiltinModel` from `@earendil-works/pi-ai/providers/all`. |
| Kimi K2.5 via pi-ai | Not in the catalog any more (K2.6, K2.7-code, K3 only). `maker.ts` clones the gateway's Workers AI K2.6 descriptor as `workers-ai/@cf/moonshotai/kimi-k2.5` with Workers AI's K2.5 prices ($0.60 in, $0.10 cached, $3.00 out per M). |

**One key for every model.** All three models go through one Cloudflare AI Gateway: pi-ai's `cloudflare-ai-gateway` provider sends only `cf-aig-authorization: Bearer <CLOUDFLARE_API_KEY>` (it strips `Authorization` / `x-api-key`), so Claude bills to the gateway's Unified Billing credits (5% fee on credit purchases, no markup on tokens) and Kimi K2.5 runs on Workers AI: the same `@cf/moonshotai/kimi-k2.5` the API's Make uses today. Needs `CLOUDFLARE_API_KEY` (AI Gateway Run), `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_GATEWAY_ID`; the gateway must have authentication on and must not store a `default` BYOK key (that blocks the Unified Billing fallback). It also gives the Maker the gateway's logs and spend limits for free.

Evidence so far (no model call needed):

- Requests go to `gateway.ai.cloudflare.com/v1/<account>/<gateway>/anthropic/v1/messages` (Claude) and `…/compat/chat/completions` (Kimi), and the payload's `tools` is exactly `["run_node", "load_skill"]`.
- Active tools: `["run_node", "load_skill"]`; system prompt sections: preamble (ours) + `cwd`.
- After creating a session and appending messages: nothing under `cwd`, the `agentDir` is never created, `~/.pi` is untouched.
- A transcript exported to JSONL (header, model change, thinking level, 2 messages) restores in a **new process** with both messages intact.

Live, on Kimi K2.5 (`pnpm -F maker spike:sdk --model kimi-k2.5`):

- The request's `tools` is exactly `run_node`, `load_skill`; nothing in the system prompt mentions file tools.
- After two prompts with tool calls: nothing under `cwd`, `~/.pi` untouched.
- Exported 9 messages to JSONL, started a **new process**, restored with `SessionManager.inMemory(…, entries)`, asked for the secret word from the first process: `"pumpkin"`.
- `steer()` and `followUp()` called during a `run_node` call both return `"queued"`. The steer lands as a user message right after that tool's result (same run, next turn); the follow-up lands after the agent has nothing left to do; one `prompt()` resolves after both, then `agent_settled` fires. That's the "make it pink" mid-run path, as designed. pi also puts an empty `system` message at the head of `session.messages`.

## 2. Box

`src/box.ts`: `Box { run(code, {timeoutMs}) → {stdout, stderr, exitCode, files}; writeFile; readFile }`.

- `run` writes the code to a temp `.mjs` and runs `node exec.js <file>` in the workspace. `image/exec.js` puts `read`, `write`, `patch(file, old, new)` (throws unless exactly one match), `playtest()` and `minify()` on `globalThis`, then imports the file (top-level await works). `files` = workspace files changed by the run.
- `playtest()` strips game.ts's types with esbuild, inlines `runtime.js` + `game.js` into `preview.html`, serves it to headless Chromium at 360×540 with `GAME_CSP` as a real response header (so `sandbox allow-scripts` applies), aborts every other request, taps and presses arrows for 3 s, then writes `playtest.png` and returns `{ok, errors, warnings, state, score, objects, time}`. `ok` = no console errors and the game clock ran.
- **LocalBox**: temp dir, child process with only `HOME`, `PATH` and the browsers path in its env (test: `src/box.test.ts`). No isolation: spike only.
- **E2BBox**: template `hopon-maker` from `image/build.ts` (node 24, ffmpeg, esbuild, playwright-core 1.58.2 + chromium-headless-shell, `/opt/hopon/{exec,runtime}.js`), built in 73 s. Created with `allowInternetAccess: false`.

Measured (20 cycles, E2B, 2 vCPU / 2 GB, called from a laptop; `src/spike-box.ts`):

|                                            | p50     | p90     | max     |
| ------------------------------------------ | ------- | ------- | ------- |
| `Sandbox.create`                           | 455 ms  | 532 ms  | 573 ms  |
| `pause()`                                  | 323 ms  | 433 ms  | 521 ms  |
| `Sandbox.connect` (resume) + first `run`   | 458 ms  | 587 ms  | 908 ms  |
| `run` again after resume                   | 258 ms  | 357 ms  | 369 ms  |
| first `run` in a fresh box (cold node)     | 1467 ms | 1608 ms | 1807 ms |
| first `playtest()` in a fresh box          | 22.2 s  |         |         |
| next `playtest()` (3 s of it is play time) | 4.4 s   |         |         |

An earlier pass that never ran node before pausing measured resume + first run at p50 3.3 s: the cold-node cost lands on whichever run comes first. The 22 s first playtest is Chromium's cold start; warming it in the template (a start command that launches Chromium once before the snapshot) should move it out of the first turn.

Isolation checks from inside the box:

- `fetch("https://example.com")` fails: the connection hangs until our 5 s timeout (dropped, not refused).
- `process.env` has only `E2B_EVENTS_ADDRESS E2B_SANDBOX E2B_SANDBOX_ID E2B_TEMPLATE_ID HOME LOGNAME PATH PS1 PWD SHELL SHLVL USER _`: no secrets.
- Gotchas: `npm init` now writes `"type": "commonjs"`, so ESM `exec.js` needed `npm pkg set type=module`; the template's `setEnvs` applies to the build but not to `commands.run`, so `exec.js` finds Chromium itself.

## 3. LittleJS skill and runtime

- `skills/littlejs-api.md`: rules (globals only, procedural drawing, portrait 20-unit-wide world, touch first), the hopon scaffold API, the five hooks, math/colour, drawing, `EngineObject`, particles, input, ZzFX `Sound` with starter sounds, how to playtest, and three complete games (flappy, Lights Out puzzle, drag-to-dodge). All three pass `playtest()` in LocalBox and the first in E2B.
- `image/scaffold.js` + `src/runtime.ts` → `image/runtime.js`: LittleJS core in release mode (the engine's own release file list minus all plugins) + the scaffold, minified. The scaffold owns the start screen (title, hint, tap to start), score, game over / win, best score and tap-to-restart, pausing the engine outside play. Games call `hopon.addScore()` and `hopon.gameOver(won)`.

Surprises:

- **LittleJS is no longer ~40 KB.** 1.26.1's `littlejs.min.js` is 474 KB / 147 KB gzipped (3D, box2d, editor). Our core-only runtime is **148 KB / 47 KB gzipped**; their strip-ASSERT step would trim more. Still fine for a cached `/runtime/v1.js`, but the plan's number is off by 3×.
- Today's `GAME_CSP` has `script-src 'unsafe-inline'` only. The plan's `<script src="/runtime/v1.js">` needs `'self'` added. Chromium runs a `'self'` script under `sandbox allow-scripts` (checked); WebKit (iOS WebView) not yet checked.
- LittleJS's globals are `let`s, so they're not on `window`; the scaffold looks hooks up by name, and the playtest reads state by name. A game's `const gameUpdate = …` works too.
- The release build keeps running after a per-frame exception (per engine.js), so a game can look alive while throwing every frame; `playtest()` counts console errors, which catches it.

## 4. Eval

EVAL_TABLE_PLACEHOLDER

## Recommendation

RECOMMENDATION_PLACEHOLDER
