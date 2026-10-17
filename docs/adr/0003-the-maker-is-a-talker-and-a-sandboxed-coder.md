# 3. The Maker is a Talker in a Durable Object and a Coder whose tools run in a sandbox

## Status

Accepted. Settled by the spikes, prototypes and research linked from the wayfinder map [#111](https://github.com/chengchao/hopon/issues/111), which also holds the decisions still open. Evidence branches:

- `claude/bold-kowalevski-b96583` (`apps/maker/SPIKE.md`): pi SDK, E2B, LittleJS, four models on five prompts.
- `claude/sweet-sanderson-1d4887` (`apps/maker/SPIKE-B.md`): pi's built-in tools with E2B-backed `operations`, native skills and `AGENTS.md`.
- `prototype/feed-audio` (`docs/research/feed-audio-prototype.md`): served runtime, music in the feed, pause and mute bridge.
- `prototype/rn-websocket` (`docs/research/rn-websocket-prototype.md`): React Native WebSocket to a hibernating Durable Object.
- `research/maker-hosting`, `research/e2b-pause-warmup`, `research/talker-on-workerd`, `research/elevenlabs-music`, `research/music-api-terms`.

Replaces today's one-shot generation in `POST /api/games` (`generate` → `parseGame` in `apps/api/src/index.ts`).

## Context

Make is one Kimi K2.5 call on Workers AI that returns a whole HTML document. There is no conversation, no way to fix a broken game, and no sound. Before launch, Make becomes a chat with the **Maker**: an agent that makes the game, plays it, fixes it and gives it music and sound. The agent executes code it wrote from a public prompt, so where that code runs is a security boundary, not a convenience.

## Decision

The Creator talks to one Maker. Inside, it is two agents with a narrow contract between them.

- **The Talker holds the conversation.** One Durable Object per Draft in the API Worker. It owns the transcript, the Draft's Revisions and the app's connection, and it decides when to build. It calls the Coder with a structured `build(spec)`, never with the Creator's words. Its agent framework is still open: pi-durable through Cloudflare's `PiHarness`, which resumes a turn from its last checkpoint after an eviction or a deploy, or an Effect AI loop of our own ([#128](https://github.com/chengchao/hopon/issues/128)). Vercel AI SDK is known to run there too, with only `nodejs_compat`.
- **Both services are hosted with Effect**, as the API is (ADR 0001): the Talker's Durable Object and the Coder's container server. Libraries that aren't Effect (pi, E2B) are wrapped as Effect services at the edge.
- **The Coder makes the game.** `@earendil-works/pi-coding-agent`, pinned to an exact version, in a Cloudflare Container bound to the Worker (`max_instances: 1`, rollout grace of at least 300 s). Its built-in tools (`read`, `write`, `edit`, `bash`, `find`, `ls`) stay pi's, but their `operations` are implemented over the E2B SDK, so every file and process operation happens in the Draft's sandbox. `grep` has no remote operations in 1.2.0 and is left out. Skills and `AGENTS.md` live on the container's disk under a second `cwd` given to pi's resource loader, and `read` routes paths under it to local disk; pi's habit of forwarding the container's environment into `exec` is ignored on purpose.
- **One E2B sandbox per Draft, holding nothing durable and nothing secret, with no egress.** It runs only what the model typed. Paused between turns (a paused box costs nothing and doesn't count toward concurrency; resume is about a second with processes intact) and killed when abandoned. Chromium is started by the template's start command so it is warm in the snapshot. The workspace is copied to R2 at the end of every turn, so the box is a cache over R2.
- **Games are LittleJS, written as `game.ts` against five hooks, run by a served runtime.** `/runtime/v1.js` is LittleJS core without plugins (about 150 KB, 47 KB gzipped), cached and versioned, plus a scaffold that owns the start screen, score, win and loss, restart, audio unlock and the feed's pause, resume and mute bridge. `GAME_CSP` gains `script-src 'self'` and `media-src 'self'`; the game WebView drops `incognito` so the runtime stays cached. Card, quiz and word games keep the plain-DOM path. A published Game keeps the runtime version it was built with.
- **Playtest before the Creator sees anything.** A script in the box typechecks `game.ts`, runs the game in headless Chromium at 360×540 under the game CSP, and returns console errors and a screenshot the Coder looks at. "Green" is the Coder's and the eval's signal.
- **Models by eval, through the Cloudflare AI Gateway.** The spikes point at Claude Haiku 5.5 ($0.004 a game, 5 of 5 green) with Sonnet 5.5 ($0.05) as the "make it better" tier; the eval decides. Kimi K2.5 is out: about eight minutes a game, since its reasoning can't be turned off through the gateway.
- **Sound.** Sound effects and short stingers are ZzFX, synthesized in the runtime. One music track per game comes from Google Lyria 3 Clip on the Gemini API paid tier: 30 s for $0.04, from a prompt the Maker writes into `audio.json`, looped with an ffmpeg cross-fade, stored in R2 and served same-origin. Music is optional: if generation fails the game ships without it and a later turn can retry. The sandbox never calls a provider.
- **The app talks only to the Worker.** Every event of a turn is a numbered entry in the Talker's event log (Durable Object SQLite), whether or not anyone is connected. The app reads it over a WebSocket accepted with the Hibernation API: it fetches a one-time ticket with its Clerk token, connects, and on every reconnect sends the last number it applied and gets the rest replayed. While a turn runs the Talker sends at least one message every 15 s, and the app treats 40 s of silence as a lost connection. A turn always ends with `turn_done` or `turn_failed`, the latter appended by a 5-minute abort timer if the Coder never answers. (If the Talker runs on pi-durable, its event stream starts with a snapshot instead of replaying by number; #128 decides how reconnects work then.) Messages and Stop are POSTs through the Worker, which keeps Screening, moderation, publish and the secrets. Polling the same log is the fallback.

## Considered

- **One agent: pi on a Node server, the design before this one.** Simpler, one prompt to tune. Splitting gives the conversation a home that is free while idle and always responsive, lets the Coder be a restartable job runner that never reads the Creator's words, and lets each half use a different model.
- **Claude Agent SDK in the sandbox.** The best-tuned harness, but it must run where the shell is, so a key and the transcript sit in the box, and it is Claude-shaped. Kept as a reference for skills and evals.
- **pi inside the sandbox.** The same key-in-box and state-in-box costs, plus a runner per box. pi's `operations` make it unnecessary.
- **Our own loop with one `run_node` tool** instead of pi's tools. Spike A built it: 3 turns a game by construction and slightly cheaper. It is the fallback if pi's tool set keeps changing under us (1.0.4 to 1.3.0 in ten days).
- **Docker on a server we run** instead of E2B. Cheaper at volume, but a container is not a VM boundary for code from a public prompt without gVisor or Kata, and pause, egress policy and capacity become ours.
- **Fly, Fargate, Cloud Run** for the Coder. All work; each adds a public endpoint, a shared secret and a second deploy. App Runner and Lambda can't hold a 5-minute turn.
- **SSE** for events. It works on iOS through `expo/fetch`, but Cloudflare recommends WebSockets with hibernation for Durable Objects, React Native has `WebSocket` built in, and an open SSE stream bills the object's duration.
- **ElevenLabs Music.** Good output, but its self-serve plans are for individual use only, and its rights when bought through Cloudflare's gateway are unstated. MiniMax trains on input and output.
- **A curated CC0 music library**, as the source or as a fallback. Fourteen loops were found; too few to give games their own sound, and keeping one as a fallback is more code than an optional track.
- **Phaser or Kaplay.** Larger APIs the model knows better, but they expect loaded assets, own the loop, and can't be linted against an allowlist. All four models wrote working LittleJS from a one-file skill.

## Consequences

- One more runtime to deploy: the Coder's container image and the E2B template, deployed with the same `wrangler deploy` and secrets as the API ([#37](https://github.com/chengchao/hopon/issues/37)).
- Cost per game moves from cents of Workers AI to about $0.01 to $0.06 of model tokens, a cent of sandbox time, and $0.04 when it has music. A global cap ([#34](https://github.com/chengchao/hopon/issues/34)) matters more; per-account quotas stay as they are for now.
- The AI disclosure ([#52](https://github.com/chengchao/hopon/issues/52)) names Anthropic, through the Cloudflare AI Gateway, and Google. Draft snapshots join the prune job ([#39](https://github.com/chengchao/hopon/issues/39)).
- Unpublished Drafts need assets the WebView can load without a Clerk token, since subresources carry no headers.
- E2B's Hobby tier allows 20 running sandboxes and an hour of continuous run time; Pro ($150 a month) allows 100.
- Still to check on a real iPhone: the ringer switch, reconnecting after iOS suspends the app, and the served runtime under WebKit's `sandbox allow-scripts`.

## Revisit when

- pi's `grep` and other tools take `operations`, or its tool set stops changing between minor versions (then drop the `run_node` fallback), or
- the eval shows a cheaper model matching Sonnet's quality through our own loop but not through pi's tools, or
- E2B's paused-sandbox pricing or reliability makes "pause between turns" worse than "restore from R2 every turn", or
- Lyria leaves preview with different terms, or a music API offers clear commercial rights with loopable output.
