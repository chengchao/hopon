# 3. The Maker is a Talker in a Durable Object and a Coder whose tools run in a sandbox

## Status

Accepted. Settled by the spikes, prototypes and research linked from the wayfinder map [#111](https://github.com/chengchao/hopon/issues/111), which also holds the decisions still open. The served runtime (`/runtime/v1.js`) and the feed's pause and mute bridge are built in [#137](https://github.com/chengchao/hopon/issues/137). Evidence branches:

- `claude/bold-kowalevski-b96583` (`apps/maker/SPIKE.md`): pi SDK, E2B, LittleJS, four models on five prompts.
- `claude/sweet-sanderson-1d4887` (`apps/maker/SPIKE-B.md`): pi's built-in tools with E2B-backed `operations`, native skills and `AGENTS.md`.
- `prototype/feed-audio` (`docs/research/feed-audio-prototype.md`): served runtime, music in the feed, pause and mute bridge.
- `prototype/rn-websocket` (`docs/research/rn-websocket-prototype.md`): React Native WebSocket to a hibernating Durable Object.
- `prototype/talker-framework` (`docs/research/talker-framework-prototype.md`): pi-durable through PiHarness against an Effect AI loop for the Talker.
- `prototype/music-source` (`docs/research/music-source-prototype.md`): a ZzFXM song against a Node synthesizer the model writes, scored blind.
- `research/maker-hosting`, `research/e2b-pause-warmup`, `research/talker-on-workerd`, `research/elevenlabs-music`, `research/music-api-terms`.

Replaces today's one-shot generation in `POST /api/games` (`generate` → `parseGame` in `apps/api/src/index.ts`).

## Context

Make is one Kimi K2.5 call on Workers AI that returns a whole HTML document. There is no conversation, no way to fix a broken game, and no sound. Before launch, Make becomes a chat with the **Maker**: an agent that makes the game, plays it, fixes it and gives it music and sound. The agent executes code it wrote from a public prompt, so where that code runs is a security boundary, not a convenience.

## Decision

The Creator talks to one Maker. Inside, it is two agents with a narrow contract between them.

- **The Talker holds the conversation.** One Durable Object per Draft in the API Worker. It owns the transcript, the Draft's Revisions and the app's connection, and it decides when to build. It calls the Coder with a structured `build(spec)`, never with the Creator's words. Its loop is pi-durable (`@earendil-works/pi-durable`) run by Cloudflare's `PiHarness` on the Agents SDK's `Agent` class, with exact version pins. pi keeps the transcript and runs in the object's SQLite; its Lifecycle heartbeat restarts the object after an eviction or a deploy and resumes the run from its last checkpoint. `Harness.open` gets `contextRetentionMs: 0` and `documentRetentionMs: 0` so the object hibernates between turns. `build` is registered with `replay: "safe"` and derives its job id from the call, so a resumed turn re-attaches to the running Coder job instead of starting another ([#128](https://github.com/chengchao/hopon/issues/128), `prototype/talker-framework`).
- **Both services are hosted with Effect**, as the API is (ADR 0001): the Talker's Durable Object and the Coder's container server. Libraries that aren't Effect (pi, PiHarness, E2B) are wrapped as Effect services at the edge.
- **The Coder makes the game.** `@earendil-works/pi-coding-agent`, pinned to an exact version, in a Cloudflare Container bound to the Worker, one instance per Draft (`getByName(draftId)`, instance type `basic`, `max_instances: 20`, `sleepAfter` 2 minutes, rollout grace of at least 300 s). An instance runs one job at a time, and `max_instances` is the global cap on running turns, matching E2B Hobby's 20 running boxes ([#122](https://github.com/chengchao/hopon/issues/122)). Its built-in tools (`read`, `write`, `edit`, `bash`, `find`, `ls`) stay pi's, but their `operations` are implemented over the E2B SDK, so every file and process operation happens in the Draft's sandbox. `grep` has no remote operations in 1.2.0 and is left out. Skills and `AGENTS.md` live on the container's disk under a second `cwd` given to pi's resource loader, and `read` routes paths under it to local disk; pi's habit of forwarding the container's environment into `exec` is ignored on purpose.
- **One E2B sandbox per Draft, holding nothing durable and nothing secret, with no egress.** It runs only what the model typed. Paused between turns (a paused box costs nothing and doesn't count toward concurrency; resume is about a second with processes intact) and killed when abandoned. Chromium is started by the template's start command so it is warm in the snapshot. The workspace is copied to R2 at the end of every turn, so the box is a cache over R2.
- **Games are LittleJS, written as `game.ts` against five hooks, run by a served runtime.** `/runtime/v1.js` is LittleJS core without plugins (about 150 KB, 47 KB gzipped), cached and versioned, plus a scaffold that owns the start screen, score, win and loss, restart, audio unlock and the feed's pause, resume and mute bridge. `GAME_CSP` gains `script-src 'self'` and `media-src 'self'`; the game WebView drops `incognito` so the runtime stays cached. Card, quiz and word games keep the plain-DOM path. A published Game keeps the runtime version it was built with.
- **Playtest before the Creator sees anything.** A script in the box typechecks `game.ts`, runs the game in headless Chromium at 360×540 under the game CSP, and returns console errors and a screenshot the Coder looks at. "Green" is the Coder's and the eval's signal.
- **Models by eval, chosen per agent.** The Talker and the Coder can use different models. Candidates are Claude Haiku 5.5, Claude Sonnet 5.5, DeepSeek and Kimi K3, through the Cloudflare AI Gateway or the provider's own API where the gateway doesn't serve a model; the eval scores quality, cost and time per turn, since a chat can't wait minutes. The spikes measured Haiku 5.5 at $0.004 a game and Sonnet 5.5 at $0.05, both 5 of 5 green, and Kimi K2.5 (today's Make model) at about eight minutes a game, which rules out K2.5 itself.
- **Sound.** Sound effects and short stingers are ZzFX, synthesized in the runtime. Music is optional per game, and the Coder writes it as code: `music.mjs`, a synthesizer with its own oscillators, envelopes, drums and mix that imports only `node:` built-ins, written from the Talker's genre and mood brief. It runs in the box and renders `music.wav`, which the harness re-encodes to Opus at 64 kbps for the Revision. A follow-up patches the script and renders again. Nothing in the box calls a provider ([#129](https://github.com/chengchao/hopon/issues/129)).
- **The app talks only to the Worker.** pi commits every change of a turn to storage before anything is shown, whether or not anyone is connected. The app connects over a WebSocket (a one-time ticket fetched with its Clerk token) and, on every connect, gets pi's snapshot of the session, then live batches. There is no replay cursor; a reconnect is a fresh snapshot, about 3.5 KB per build turn. While pi is busy the Talker sends at least one message every 15 s, and the app treats 40 s of silence as a lost connection. A turn always ends with `turn_done` or `turn_failed`, taken from pi's submission records; a 5-minute cap aborts a turn whose Coder never answers. Messages and Stop are POSTs through the Worker, which keeps Screening, moderation, publish and the secrets.

## Considered

- **One agent: pi on a Node server, the design before this one.** Simpler, one prompt to tune. Splitting gives the conversation a home that is free while idle and always responsive, lets the Coder be a restartable job runner that never reads the Creator's words, and lets each half use a different model.
- **An Effect AI loop of our own** for the Talker (`effect/ai` `LanguageModel` and `Toolkit`, a numbered event log replayed by `since=N`). It survived a restart mid-build and re-attached to the job too, was half the bundle and stayed in the API's style, but it is more code of ours (337 lines against 157) on an ecosystem too small to lean on; Cloudflare and pi own the run instead.
- **Vercel AI SDK** for the Talker. Runs in a Durable Object with only `nodejs_compat`, but it is another loop of our own.
- **Claude Agent SDK in the sandbox.** The best-tuned harness, but it must run where the shell is, so a key and the transcript sit in the box, and it is Claude-shaped. Kept as a reference for skills and evals.
- **pi inside the sandbox.** The same key-in-box and state-in-box costs, plus a runner per box. pi's `operations` make it unnecessary.
- **Our own loop with one `run_node` tool** instead of pi's tools. Spike A built it: 3 turns a game by construction and slightly cheaper.
- **Docker on a server we run** instead of E2B. Cheaper at volume, but a container is not a VM boundary for code from a public prompt without gVisor or Kata, and pause, egress policy and capacity become ours.
- **Fly, Fargate, Cloud Run** for the Coder. All work; each adds a public endpoint, a shared secret and a second deploy. App Runner and Lambda can't hold a 5-minute turn.
- **SSE** for events. It works on iOS through `expo/fetch`, but Cloudflare recommends WebSockets with hibernation for Durable Objects, React Native has `WebSocket` built in, and an open SSE stream bills the object's duration.
- **A ZzFXM song the runtime plays.** Tiny and needs no render step, but it scored lower in a blind listen (3.5 against 3.9), its player cuts ringing notes at the loop end, leaving dips or up to 0.65 s of silence, and it renders on the main thread at the first tap.
- **Google Lyria 3 Clip** ($0.04 per 30 s clip). Not heard: the key on hand was free tier, which allows no requests. It would put a provider call behind the box, and a follow-up could only regenerate the clip, not edit it.
- **ElevenLabs Music.** Good output, but its self-serve plans are for individual use only, and its rights when bought through Cloudflare's gateway are unstated. MiniMax trains on input and output.
- **A curated CC0 music library**, as the source or as a fallback. Fourteen loops were found; too few to give games their own sound, and keeping one as a fallback is more code than an optional track.
- **Phaser or Kaplay.** Larger APIs the model knows better, but they expect loaded assets, own the loop, and can't be linted against an allowlist. All four models wrote working LittleJS from a one-file skill.

## Consequences

- One more runtime to deploy: the Coder's container image and the E2B template, deployed with the same `wrangler deploy` and secrets as the API ([#37](https://github.com/chengchao/hopon/issues/37)).
- Cost per game moves from cents of Workers AI to about $0.01 to $0.06 of model tokens, a cent of sandbox time, and about $0.005 more for music on Haiku 5.5 ($0.03 on Sonnet 5.5). Music adds 18–63 s to the turn that writes it. A global cap ([#34](https://github.com/chengchao/hopon/issues/34)) matters more; per-account quotas stay as they are for now.
- The AI disclosure ([#52](https://github.com/chengchao/hopon/issues/52)) names every model provider the eval picks. Draft snapshots join the prune job ([#39](https://github.com/chengchao/hopon/issues/39)).
- Unpublished Drafts need assets the WebView can load without a Clerk token, since subresources carry no headers.
- E2B's Hobby tier allows 20 running sandboxes and an hour of continuous run time; Pro ($150 a month) allows 100.
- PiHarness is beta and pi-durable is experimental. Pin exact versions, and run the prototype's eviction and snapshot scripts as the test for every upgrade. The Talker's bundle is about 965 KiB gzipped; move it to its own Worker if that matters. Claude Haiku 5.5 needs a request rewrite until the AI Gateway bills it.
- Still to check on a real iPhone: the ringer switch, reconnecting after iOS suspends the app, the served runtime under WebKit's `sandbox allow-scripts`, and that the Opus music loops without a gap however the feed plays it (the prototype used Web Audio).

## Revisit when

- pi's `grep` takes `operations`, or
- the eval shows a cheaper model matching Sonnet's quality through our own loop but not through pi's tools, or
- a PiHarness or pi-durable upgrade breaks resume after eviction, or snapshots grow too large to resend on every reconnect, or
- E2B's paused-sandbox pricing or reliability makes "pause between turns" worse than "restore from R2 every turn", or
- model-written music stops sounding good enough next to a generated source whose terms allow it.
