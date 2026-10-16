# 3. The Maker is a pi agent on our server whose tools run in a per-Draft sandbox

## Status

Accepted. Decided after two spikes, `apps/maker/SPIKE.md` (branch `claude/bold-kowalevski-b96583`) and `apps/maker/SPIKE-B.md` (branch `claude/sweet-sanderson-1d4887`), and the feed-audio prototype in `docs/research/feed-audio-prototype.md` (branch `prototype/feed-audio`). Replaces today's one-shot generation in `POST /api/games` (`generate` → `parseGame` in `apps/api/src/index.ts`).

## Context

Make is one Kimi K2.5 call on Workers AI that returns a whole HTML document. There is no conversation, no way to fix a broken game, and no sound. Before launch, Make becomes a chat with the **Maker**: an agent that makes the game, plays it, fixes it and gives it music and sound. The agent executes code it wrote from a public prompt, so where that code runs is a security boundary, not a convenience.

## Decision

- **Harness: `@earendil-works/pi-coding-agent`, pinned to an exact version, on a Node server we run (the Maker).** Its built-in tools (`read`, `write`, `edit`, `bash`, `find`, `ls`) stay pi's, but their `operations` are implemented over the E2B SDK, so every file and process operation happens in the Draft's sandbox. pi's prompts, skills discovery, `AGENTS.md` context files, compaction, `steer()` and `followUp()` are used as they are. `grep` has no remote operations in 1.2.0 and is left out.
- **One sandbox per Draft (E2B), holding nothing durable and nothing secret, with no egress.** The box runs only what the model typed. The model key, the E2B token and the Worker service token live on the Maker; pi's habit of forwarding the Maker's environment into `exec` is ignored on purpose. A box is paused between turns and killed after a day idle; the workspace is snapshotted to R2 at the end of every turn, so the box and the Maker's memory are caches over R2.
- **Two working directories.** The session's `cwd` is `/workspace` in the box, for tools. The resource loader's `cwd` is a directory on the Maker holding `AGENTS.md` and `.agents/skills/`, and `read` routes paths under it to the Maker's disk. Skills are repo files; the box never sees them.
- **Games are LittleJS, written as `game.ts` against five hooks, run by a served runtime.** `/runtime/v1.js` (LittleJS core without plugins, ~150 KB, cached, versioned) plus a scaffold that owns the start screen, score, win and loss, restart, audio unlock and the feed's pause, resume and mute bridge. `GAME_CSP` gains `script-src 'self'` and `media-src 'self'`. Card, quiz and word games keep the plain-DOM path. A published Game keeps the runtime version it was built with.
- **Playtest before the person sees anything.** A script in the box typechecks `game.ts`, runs the game in headless Chromium at 360×540 under the game CSP, and returns console errors and a screenshot, which pi's `read` attaches as an image. "Green" is the Maker's and the eval's signal.
- **Model by eval, through one Cloudflare AI Gateway behind a Worker proxy.** The spikes point at Haiku 5.5 as the default ($0.004 a game, 5/5 green) with Sonnet 5.5 ($0.05) as the "make it better" tier; the 30-prompt eval decides. Kimi K2.5 is out: about eight minutes a game, since its reasoning can't be turned off through the gateway.
- **Audio.** Sound effects are ZzFX, synthesized in the runtime. One music track per game comes from ElevenLabs through a Worker tool, is stored in R2 and served same-origin; a curated CC0 set is the fallback so a game is never silent. The box never calls a provider.
- **The app talks only to the Worker.** `POST /api/drafts/:id/messages` and `/stop`, `GET /events` as SSE (`expo/fetch` streams on iOS and resumes with `Last-Event-ID`), all proxied to the Maker. The Worker keeps Screening, quotas, moderation, publish and every secret but the model key.

## Considered

- **Claude Agent SDK in the sandbox.** The best-tuned harness, but it must run where the shell is, so the model key (or a per-job token) sits in the box, the canonical transcript is a JSONL file there, and the harness is Claude-shaped; cheaper models fit badly. Kept as a reference for skills and evals.
- **pi inside the sandbox.** Same key-in-box and state-in-box costs as above, plus a runner process per box. pi's `operations` make it unnecessary.
- **Our own loop (AI SDK or `pi-agent-core`) with one `run_node` tool.** Spike A built it: 3 turns a game by construction, $0.012 and 4 s cheaper than pi's tools, and it works on any box with Node. It is the fallback if pi's tool set keeps changing under us (1.0.4 to 1.3.0 in ten days), at the price of maintaining tools, a `load_skill` tool and a system prompt that pi otherwise provides.
- **A Durable Object as the Maker.** Cheap and co-located, but pi needs Node, and the DO added nothing once SSE replaced WebSockets.
- **Phaser or Kaplay.** Larger APIs the model knows better, but they expect loaded assets, own the loop, and can't be linted against an allowlist. All four models wrote working LittleJS from a one-file skill.
- **Generated sound effects.** Possible through the same ElevenLabs tool; synthesis is instant and free for the dozens of tiny sounds a game needs, and generation is reserved for music.

## Consequences

- A second deploy target: the Maker container and the E2B template, with their own secrets ([#37](https://github.com/chengchao/hopon/issues/37)).
- Cost per game moves from cents of Workers AI to about $0.01 to $0.06 of tokens plus a cent of sandbox time, with audio on top. The daily quota becomes a real budget cap; a global cap ([#34](https://github.com/chengchao/hopon/issues/34)) moves up.
- Two more processors, the model provider and ElevenLabs, in the AI disclosure ([#52](https://github.com/chengchao/hopon/issues/52)). Draft snapshots join the prune job ([#39](https://github.com/chengchao/hopon/issues/39)).
- Unpublished Drafts need assets the WebView can load without a Clerk token, since subresources carry no headers: short-lived signed URLs.
- Three findings from the spikes still need a real device: the ringer switch, SSE resume after iOS suspends the app, and the served runtime under WebKit's `sandbox allow-scripts`.

## Revisit when

- pi's `grep` and other tools take `operations`, or its tool set stops changing between minor versions (then drop the `run_node` fallback), or
- the eval shows a cheaper model matching Sonnet's quality through our own loop but not through pi's tools, or
- E2B's paused-sandbox pricing or reliability makes "pause between turns" worse than "restore from R2 every turn".
