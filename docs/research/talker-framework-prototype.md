# Which framework runs the Talker: pi-durable through PiHarness, or an Effect AI loop?

Prototype for [#128](https://github.com/chengchao/hopon/issues/128), part of map [#111](https://github.com/chengchao/hopon/issues/111). Run 2026-10-17 on branch `prototype/talker-framework`. Code: `apps/talker-proto/` (throwaway). Logs: `docs/research/talker-framework-prototype/`.

**Question:** The Talker is one SQLite-backed Durable Object per Draft, hosted with Effect, with one `build(spec)` tool that calls the Coder. Should its agent loop be pi-durable through Cloudflare's `PiHarness` (A) or our own step loop over `effect/ai` (B)?

**Decision: pi-durable through PiHarness, on the `Agent` class**, with `contextRetentionMs: 0` and `documentRetentionMs: 0`, and snapshot-on-connect as the transport (§8). The owner decided against the Effect AI loop because its ecosystem is too small, and chose to let Cloudflare and pi own the run.

How we got there:

- **First round** (A, plain DO, vs B, Effect AI loop): both survived a restart mid-build (each turn finished on its own and re-attached to the same Coder job, one start and one attach), handled steer and Stop the same way, and reached Sonnet 5.5 and Haiku 5.5. I recommended B, mostly because it already is #111's numbered-log transport with `since=N`, and pi has no replay cursor.
- **Follow-up 1:** that recommendation also leaned on "A never hibernates", which was wrong. pi's two 10-minute retention timers kept the object awake; with both at 0 it hibernates within 40 s (§3). A2 ran the same Talker on the `Agent` class, as the docs lead with, and recovered the same way.
- **Follow-up 2** (§8): A2 with retention 0 and an app-style client that keeps its view only from pi's snapshot and live batches. After a 20 s absence, a restart mid-build, 40 s of hibernation and a Stop, the client's view matched the server's transcript exactly every time. Retention 0 adds no measurable latency to a warm turn.

What we accept with pi:

- PiHarness is beta, so pin exact versions and re-test the restart path on every upgrade.
- Effect runs inside `Agent`'s handlers rather than owning the object.
- The bundle is 965 KiB gzip, so give the Talker its own Worker if the API's cold start suffers.
- Haiku 5.5 needs a fetch shim until the gateway bills it.

## Setup

- `apps/talker-proto`, exact pins: `agents@0.28.1`, `@earendil-works/pi-durable@1.3.0`, `@earendil-works/pi-ai@1.3.0`, `effect@4.0.5`, `@effect/ai-anthropic@4.0.5`, `@effect/sql-sqlite-do@4.0.5`, `wrangler@4.151.0` (workerd 1.20261012), `compatibility_date 2026-09-01`, `nodejs_compat`.
- Three `wrangler dev` servers: the fake Coder (`src/coder.ts`, :8790), Talker A (`src/a.ts`, :8791, AI binding remote) and Talker B (`src/b.ts`, :8792).
- **Fake Coder:** one Durable Object per job id. `POST /jobs/:id` starts the job the first time and attaches every time after that. It streams `progress n/60` from the job's own clock, so a re-attach picks up mid-job, and it counts `starts` and `attaches`. `POST /jobs/:id/cancel` stops the job.
- **A:** a plain `DurableObject` with `Lifecycle.install(this).use(harness).use(webSockets)`. `PiHarness` opens `Harness.open` with `createAI({ binding: env.AI })` as the provider (Sonnet), plus pi-ai's own `anthropicProvider()` for Haiku (below). pi is wrapped as an Effect service (`Pi`, one `Effect.tryPromise` per method), and `onRequest` runs an Effect. `build` is a `ToolRegistration` with `replay: "safe"` and the job id kept in `api.memo("jobId", …)`. The socket gets `session.events()`: a snapshot, then batches.
- **B:** a plain `DurableObject` with a `ManagedRuntime` per object (`SqliteClient.layer({ db: ctx.storage.sql })`, `FetchHttpClient.layer`, `Toolkit.toLayer`); `fetch` runs an Effect. Each step is `LanguageModel.generateText({ disableToolCallResolution: true })`. The history is persisted as `Prompt` JSON after every model call and every tool round, and tools run through `toolkit.handle`. Limits: 12 steps, 5 minutes as `Effect.timeout`. Stop is `Fiber.interrupt`, a tick goes out every 15 s, and the event log is numbered rows replayed with `since=N`. A 30 s alarm heartbeat resumes a turn whose fiber died. The job id is `<draft>-<toolCallId>`.
- **A2** (follow-up): the same Talker as A on the docs' main path, `class TalkerAgent extends Agent` with `this.lifecycle.use(this.harness)` (`src/a2.ts`, :8793; Sonnet only). `Agent` brings the WebSocket handling (`onConnect`/`onClose`, hibernation), `shouldSendProtocolMessages() { return false }` keeps the Agent protocol off the socket, and the Worker routes with `getAgentByName`. `PI_RETENTION_MS` sets pi's `contextRetentionMs` and `documentRetentionMs`; `wrangler.a2r0.jsonc` (:8794) runs it with both at 0.
- **Follow-up 2:** A2 also sends a `tick` every 15 s while pi's session is busy (re-armed in `onStart` after a wake). `src/view-client.mjs` is the app side of snapshot-on-connect: it rebuilds its whole view from each snapshot, patches it from batches, derives `turn_done`/`turn_failed` from pi's submission records (`done` / `unanswered`), applies the 5 s backoff cap and the 40 s silence rule, and can dump its view for comparison with the server's transcript (`scripts/snap.sh`, `scripts/verify.py`, `scripts/lat.sh`).
- `src/client.mjs` is `prototype/rn-websocket`'s client logic (`ws-test.tsx`) in Node. It applies events by seq, flagging duplicates and gaps, reconnects with jittered backoff capped at 5 s, and applies the 40 s silence rule. `kill -USR1` makes it go away for 20 s.
- Models: Sonnet 5.5 and Haiku 5.5 through the account's AI Gateway (`default`, authenticated, Unified Billing), keys in `.dev.vars` copied from spike A.

## Comparison

|  | A: pi-durable via PiHarness | B: Effect AI loop |
| --- | --- | --- |
| 1. Hosting in Effect | Works, but Lifecycle **owns** `fetch`/`alarm`/`webSocket*` ("do not define forwarding versions"); our Effects run inside its `onRequest`. WebSocket upgrades are refused (404) until the `agents/websockets` capability is installed with `protocol: () => false`. Tools are promise functions, not Effects. | Native: the DO's `fetch`, `alarm` and handlers run Effects over one `ManagedRuntime`. Friction: tool handlers can't require services (capture the context in `toLayer`). A `FetchHttpClient.Fetch` shim given to a layer is silently ignored. An interrupted fiber skips `matchCauseEffect` (use `onExit`). |
| 2. Restart mid-build | **Finished by itself**, re-attached to the same job 29 s in (1 start, 1 attach), right after the server came back. Lifecycle alarm + `replay: "safe"` + `api.memo`. | **Finished by itself**, re-attached on the next 30 s heartbeat (1 start, 1 attach). Our alarm + persisted history + id from the tool call id. |
| 3. Reconnect after 20 s away | Fresh snapshot: transcript, live tool slot (`build:running:progress 25/60`), queued steer. Nothing missing as _state_, but there's no cursor and the events in between are gone. The client rebuilds its view from pi's entry types. | `since=4` replayed the 20 s it missed: no gap, no duplicate (`dup 0 gap 0`), first message in 10 ms. Same as #126. |
| Hibernation between turns | pi's defaults: **stays awake up to ~10 min** after a turn (same instance at 40, 70 and 150 s; a new one at 660 s). With `contextRetentionMs` and `documentRetentionMs` at 0: **hibernated within 40 s**, and `onStart` re-attached the held socket with a fresh snapshot. Same on the plain DO and on `Agent`. | Hibernated: after 40 s idle a new instance answered and the held socket got every event. |
| 4. Steer during build | Queued in pi's inbox; joined after the tool round (the build ran its full 60 s); the model then issued a second build. | Queued in our inbox table; applied after the tool round; same behaviour. |
| 4. Stop during build | Tool aborted in <0.5 s, Coder job cancelled, transcript records "Tool build was aborted". On the next message the model **retried the build by itself**. | `turn_failed: stopped` in ~0.1 s, Coder job cancelled. We write "Stopped by the Creator." as the tool result; the next turn asked instead of retrying. It took two bug fixes to get here (below). |
| 5. Sonnet 5.5 | Through the AI binding, no rewrite. | Through the gateway's `/anthropic` with `cf-aig-authorization`, no rewrite. |
| 5. Haiku 5.5 | Binding: 401 (`x-api-key header is required`, not on Unified Billing, as in spike A). Works through pi-ai's `anthropicProvider()` + `ANTHROPIC_AUTH_TOKEN` + a global fetch shim with **4 rewrites**: URL and model name, content-block `system` joined, mid-conversation system message hoisted, `thinking.block_binding` dropped. | Works through `/ai/v1/messages` with a `transformClient` doing **4 rewrites**: strip `?beta=true`, join `system`, drop `null`s (`cache_control: null` on every block), and add 4 `usage` keys Effect's response schema requires. |
| 6. Bundle (`deploy --dry-run`) | Plain DO 3.18 MiB raw / **577 KiB gzip** (`Agent` class: 5.32 MiB / 965 KiB). openai 713K, @anthropic-ai/sdk 580K, typebox 467K, pi-durable 324K, pi-ai 250K, effect 235K, agents 223K, chord 113K, capnweb 100K. **Photon: 0**; pi-durable's image code is never imported, so it's tree-shaken out already. | 1.49 MiB raw / **276 KiB gzip**. effect 1.2 MiB, @effect/ai-anthropic 249K. `apps/api` already bundles `effect`, so the marginal cost in the `hopon` Worker is smaller. |
| 6. Memory | V8 heap of the dev isolate mid-turn (several Drafts live): 12.1 MiB. | Same moment: 7.3 MiB. workerd RSS was 53–55 MiB for both at every step, so RSS doesn't tell them apart. Both are far below 128 MB. |
| 7. Code we own | `a.ts` 157 lines (`a2.ts` on `Agent`: 153, Sonnet only) (Effect service ~25, socket glue ~30, Haiku shim ~30, tool ~30). Add ~60 for a `since=N` log if we keep #111's transport. | `b.ts` 337 lines (step loop ~75, resume + alarm + Stop cleanup ~50, log + replay ~40, Haiku rewrites ~40). |

## Findings

### 1. Effect hosting

- **A:** `Lifecycle.install(this)` "installs the runtime-facing `fetch`, `alarm`, `webSocketMessage`, `webSocketClose`, and `webSocketError` handlers. Do not define forwarding versions of those methods." Our code moves into `onRequest` (an Effect via `runtime.runPromise`) and into capability handlers. With only `PiHarness` installed, a WebSocket upgrade returns 404 "WebSocket upgrades are not enabled on this Durable Object". The `WebSockets` capability claims upgrades, accepts with hibernation and speaks the Agent protocol unless `protocol: () => false` marks the connection no-protocol. Wrapping pi itself is easy (every method returns a promise), but pi's failures are transcript entries (`stopReason: "error"`, `errorMessage`), not typed errors. The tool's `execute(args, api, context)` is a promise function with an `AbortSignal`. To write it as an Effect, we'd run each call through the runtime and bridge the abort ourselves. On `Agent` (A2) the WebSocket part goes away: `Agent` installs the capability itself, and `shouldSendProtocolMessages() { return false }` turns off its protocol frames. Otherwise it's the same picture, with `Agent` owning even more of the object (state, scheduling, routing via `getAgentByName`).
- **B:** the whole object is Effect. Four things fought: (a) `Toolkit.toLayer` handlers must have no requirements, so the layer captures `SqlClient | HttpClient` with `Effect.context` and provides it per call. (b) `FetchHttpClient` reads `Fetch` from the _calling_ fiber (`fiber.getRef(Fetch)`), so `Layer.provide(Layer.succeed(Fetch, shim))` on the model layer is silently ignored; the Haiku rewrite had to move into `transformClient`. (c) `Effect.matchCauseEffect` doesn't run when the fiber is interrupted, so Stop left the turn marked running and the alarm "resumed" it, re-attaching to the cancelled job; `Effect.onExit` fixed it. (d) A stopped tool round left a tool call without a result in the history: the next turn would rerun it, and Anthropic rejects a `tool_use` without its `tool_result`. `finish` now closes open calls. (c) and (d) are exactly the bookkeeping pi does for A.

### 2. Restart mid-build

Each script started a build turn with no client attached, killed `wrangler dev` 20 s into the build, restarted it, and sent no further requests (`scripts/evict.sh`).

- **A** (`evict-a*.log`): the server was back at 13:41:59; at 13:42:00 the Coder logged `ATTACH at 29 s` for the same job id; the build finished at 13:42:31 and the model replied (`stop`). Lifecycle's due job restarted the object, pi reopened its tasks, the replay-safe tool reran, and `api.memo` returned the stored job id.
- **B** (`evict-b*.log`): back at 13:35:04; the alarm fired, wrote `turn_resumed` and `resume_tool_round` (the last history message was a tool call without a result), and `build` re-attached to the same job; `turn_done` followed. The resumed round counts as a step against the cap of 12. A model call cut off by an eviction is simply re-sent from the persisted history (any partial reply is lost).
- **A2** (`Agent` class, `evict-a2.log`): the same as A. Back at 18:44:25, the Coder logged `ATTACH at 28 s` for the same job, and the turn ended with a reply at 18:44:59. Lifecycle does the wake-up in both setups; neither A nor A2 has any alarm code of ours.
- Local only: alarms survived the restart because `wrangler dev` keeps `.wrangler/state`. Production eviction and a real deploy were not run.

### 3. Delivery and reconnect

- **B** is #126's transport unchanged: the client away for 20 s came back with `connect since=4` and got the missed `build_progress` rows, then live; the run ended `dup 0 gap 0`.
- **A**: the client away for 20 s came back to `SNAPSHOT entries=3 run=true tools=[build:running:progress 25/60] inbox=1`. The snapshot is the full current state, so nothing is lost for a view that redraws from state. But there is no cursor, the events in between are gone, and the client must map pi's own records (`pi.user`, `pi.assistant`, tool slots, `MessageChange` deltas) to our UI. Keeping #111's numbered log, ticks and `turn_done`/`turn_failed` under A means writing B's log anyway and feeding it from pi's events.
- pi's event streams live in memory, one per socket. After a restart or hibernation the sockets are still held but their streams are gone, so A re-attaches every held connection in `onStart` with a fresh snapshot.
- **Hibernation:** B hibernated after 40 s idle with a socket held: a new instance served the next turn, and the socket received all of it (`hib-b-client.log`). A with pi's defaults did not: the same instance answered after 40 s and 150 s with a socket held, and after 70 s with a bare socket and no pi stream (`hib*-a.log`).
- **Cause, confirmed on A2:** pi keeps an idle conversation's context, and documents nothing observes, in memory for `contextRetentionMs` / `documentRetentionMs`, both 10 minutes by default (`DEFAULT_CONTEXT_RETENTION_MS = 600_000` in pi-durable's `agent.js`). It drops them with a `setTimeout` that it marks `unref()`; on workerd `unref` does nothing, so the pending timer keeps the object awake until it fires. On A2 with defaults, the object was awake after 40 s, and a socket held for 660 s was picked up by a new instance (`hib-a2-40.log`, `hib-a2-660.log`). With both settings at 0 (`Harness.open(storage, { models, registry, settings: { contextRetentionMs: 0, documentRetentionMs: 0 } }, context)`), it hibernated within 40 s and within 90 s. On wake, `onStart` re-attached the held socket and sent a fresh snapshot, and the next turn's events arrived as usual (`hib-a2r0-*.log`). The cost of 0 is that pi reloads the conversation from SQLite at the next turn; the short replies here showed no visible delay.
- So with retention 0, A hibernates between turns like B. With defaults, an open app bills up to 10 minutes of duration after each turn (0.128 GB-s per second, #123), and the PiHarness docs don't mention either setting.
- The earlier version of this doc (and the #128 comment) said A "never hibernated with a socket held". That was an overreach: the first runs only watched up to 150 s, on default settings.

### 4. Steer and Stop while `build` runs

- **Steer** (`scenario-*.log`, steer at +15 s into the build): neither interrupts the tool. Both queue the message (A in pi's inbox, B in our inbox table), finish the 60 s build, add the steer to the conversation, and the model issues a second `build` with the change. So in both, a steer during a build waits up to a whole build.
- **Stop** (`client-*-st1.log`, Stop at +15 s): both abort the Coder fetch at once and cancel the job (A through `context.abortSignal`, B through `Effect.onInterrupt`). A's transcript then holds the partial output plus "Tool build was aborted"; asked "What happened to my game?", the model rebuilt it unprompted. B's tool result says "Stopped by the Creator.", and the model asked whether to start again. We pick that wording in B; in A it would need a pi hook.

### 5. Models through the Cloudflare AI Gateway

- Sonnet 5.5 needed no rewrite on either: A goes through `env.AI.gateway("default").run` (Unified Billing, the diagnostic names the gateway and a log id), B posts to `gateway.ai.cloudflare.com/v1/<acct>/default/anthropic/v1/messages` with `cf-aig-authorization`.
- Haiku 5.5 is still not on Unified Billing: through A's binding it answers 401 `x-api-key header is required`, as spike A found on the gateway's Anthropic route. Both prototypes send it to Cloudflare's REST `/accounts/<id>/ai/v1/messages` as `anthropic/claude-haiku-5.5`, and each needed **four** rewrites, two more than spike A listed:
  - A (pi-ai's Anthropic provider, global `fetch` shim): new URL and model name; join a content-block `system`; hoist the system message pi puts _mid-conversation_ (`messages[1].role`, spike A's other issue, which it dodged by using the gateway's descriptor); drop `thinking.block_binding` (pi's adaptive thinking sends `{type: "adaptive", display: "summarized", block_binding: {...}}`).
  - B (`transformClient`): strip `?beta=true`; join `system`; drop `null` values (Effect's provider sends `cache_control: null` on every block; Anthropic accepts it, Cloudflare rejects "messages[0].content: Invalid input"); add `usage.cache_creation`, `cache_creation_input_tokens`, `cache_read_input_tokens` and `service_tier` as `null` on the reply, because Effect's generated schema requires those nullable keys and Cloudflare omits them.
  - All of it goes away once the gateway bills Haiku 5.5.
- B calls `generateText` per step, so the Creator sees a reply when the step ends, not token by token; A streams `message_update` deltas. Swapping B to `streamText` is a contained change (its parts feed `Prompt.fromResponseParts` the same way). Talker replies are one or two sentences, so this matters little.

### 6. Bundle size and memory

- A: 3,183 KiB raw / 577 KiB gzip. pi-ai pulls the OpenAI SDK (713K) and the Anthropic SDK (580K) even though every Sonnet call goes through the binding. TypeBox adds 467K. Photon (`@silvia-odwyer/photon`, a pi-durable dependency) is **not in the bundle**: nothing on our import path reaches pi-durable's image tools, so there is no "with Photon" build to compare. Aliasing `openai` away might save 0.7 MiB; not tried.
- A2 (`Agent` class): 5,318 KiB raw / **965 KiB gzip**. On top of A's set, `Agent` pulls in zod (763K), more of `agents` (732K, up from 223K), the MCP client (442K + 50K) and mime-db (208K). The plain-DO setup is the leaner way to host pi.
- B: 1,489 KiB raw / 276 KiB gzip, 1.2 MiB of it `effect`, which `apps/api` already ships, so B's marginal cost in the `hopon` Worker is mostly `@effect/ai-anthropic` and the Effect modules the API doesn't use yet.
- Memory: the dev isolate's V8 heap, read over the inspector mid-turn with several Drafts live, was 12.1 MiB for A and 7.3 MiB for B. workerd RSS was 53–55 MiB for both servers before, after one Draft and after six, so it doesn't separate them. The inspector probe became unreliable after restarts, so there is no clean per-Draft figure. Both are an order of magnitude under the 128 MB a Durable Object gets.

### 7. Code we own

Non-blank, non-comment lines: `a.ts` 157, `b.ts` 337 (the fake Coder 60 and the client 77 are shared). B's extra ~180 lines are the step loop, the event log and its replay, the resume heartbeat and the Stop cleanup. A gets those from pi, apart from the log, which #111's transport still needs (~60 more lines in A). Both carry about 30–40 lines of Haiku rewrites that go away later.

### 8. Snapshot-on-connect on A2, retention 0 (follow-up 2)

`scripts/snap.sh a2r0 v2` (`snap-run.log`, `snap-view-client.log`) runs four steps with one client attached throughout. After each step it compares the client's view with `GET /messages`:

| Step | What the client saw | View vs server |
| --- | --- | --- |
| 1. Build; client away 20 s at +5 s; steer at +15 s | Back after 20 s: one **3,540-byte** snapshot 20 ms after connecting, holding 3 entries, the build running at `progress 25/60`, and 1 queued steer. Then live progress; the steer joined after the tool round; one run answered both messages (`turn_done` ×2). | **OK**, 8 of 8 entries |
| 2. Build; dev server restarted at +20 s | Socket dropped (1006); the client retried with backoff and got a **8,493-byte** snapshot ~8 s after the restart, build running at `progress 27/60`. Lifecycle resumed the run, `build` re-attached to the same job, `turn_done`. | **OK**, 12 of 12 |
| 3. 40 s idle, socket held, then a short turn | The object hibernated. A new instance woke on the POST, `onStart` pushed a fresh **10,022-byte** snapshot to the held socket, then the run streamed and ended `turn_done`. | **OK**, 14 of 14 |
| 4. Build; Stop at +15 s | Build aborted in <0.5 s, `turn_failed: aborted`. | **OK**, 17 of 17 |

- **Nothing missed:** after an absence, a restart and a hibernation, the view held exactly the server's entries every time. What a client that was away doesn't get is the individual events in between (here, ~20 progress lines). It gets where things stand.
- **Snapshot size** grows with the conversation: 254 B empty, about 3.5 KB after one build, about 10 KB after four turns. A build turn adds roughly 2.5–5 KB, because the retained tool output and the system entry are in it. Every reconnect re-sends that; at 30 build turns it would be on the order of 100 KB.
- **Ticks:** the 15 s tick is ours. pi's own batches came every second during the build (tool output), but a long model call is silent, so #111's 40 s rule needs the tick. It didn't fire falsely in any step.
- **Turn outcome** comes from pi's `submission` records: `done` → `turn_done`, `unanswered` → `turn_failed` with pi's reason (`aborted` on Stop). A steer is its own submission, so one run can end with two `turn_done`.
- **Retention 0 latency** (`lat.log`, POST to pi's `run_start`): 34–41 ms with defaults and 33–38 ms with retention 0 on warm turns 5 s apart, so reloading the conversation from SQLite costs nothing measurable. After 45 s idle (hibernated) it was 51–67 ms: waking the object and opening pi again adds ~15–30 ms.
- A view built this way needs only one path: draw the snapshot, apply batches. The app works with pi's records (`pi.user`, `pi.assistant`, `pi.tool-result`, tool slots), not our own event types.

## What this did not cover

- Production: only `wrangler dev` (local workerd, remote AI binding). No real deploy mid-turn, no production eviction or hibernation timing, no billing check.
- Retention 0 was run on A2 (`Agent`) only; the plain-DO A uses the same pi scheduler, so it should behave the same, but that wasn't run. Exactly when the default-retention object went to sleep between 150 s and 660 s wasn't pinned down.
- No real Coder (Container), no real app (the Node client stands in for `ws-test.tsx`), no auth or tickets.
- B without token streaming. A2 ran Sonnet only; A's Haiku shim should carry over unchanged but wasn't run on A2. The snapshot client is Node, not the RN app.
- pi's `sessions.fork`, compaction and subagents were not exercised.

## Recommendation

Build the Talker on **pi-durable through PiHarness, on the `Agent` class** (`src/a2.ts`):

- `Harness.open(storage, { models, registry, settings: { contextRetentionMs: 0, documentRetentionMs: 0 } }, context)`, so the object hibernates between turns. Retention 0 cost nothing measurable.
- **Transport:** snapshot-on-connect instead of #111's `since=N` log. On connect the socket gets pi's snapshot, then live batches. The app redraws from the snapshot. The Talker adds a 15 s tick while busy. `turn_done`/`turn_failed` come from pi's submission records. Keep #126's client rules (5 s backoff cap, 40 s silence, close on `background`). Messages and Stop stay POSTs.
- **`onStart`** re-attaches every held socket to a fresh pi stream and re-arms the tick, since pi's streams live in memory.
- **`build`** is a `ToolRegistration` with `replay: "safe"` and the job id in `api.memo` (`<draft>-<callId>`), so a rerun after an eviction re-attaches. It honours `context.abortSignal` and cancels the Coder job on abort.
- **Models:** Sonnet 5.5 through `createAI({ binding: env.AI })`. Haiku 5.5 through pi-ai's `anthropicProvider()` and the four-rewrite fetch shim from `src/a.ts`, deleted when the gateway bills Haiku 5.5.
- **Effect hosting:** pi as a `Context.Service` (one `Effect.tryPromise` per method); `onRequest` and `onConnect` run Effects.
- Pin `agents`, `@earendil-works/pi-durable` and `@earendil-works/pi-ai` exactly, and keep the restart-mid-build, Stop-mid-build and hibernation checks (`scripts/evict.sh`, `scripts/snap.sh`) as the upgrade test. Put the Talker in its own Worker if 965 KiB gzip shows up in the API's cold starts.
- Decide later whether Stop should read differently to the model: pi records "Tool build was aborted", and the model then retried on its own. A pi hook could word it as "Stopped by the Creator".

The Effect AI loop (`src/b.ts`) stays on the branch as the fallback; §1–§7 list what it took.
