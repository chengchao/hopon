# The Coder on workerd, with its box as a Durable Object Container

Spike for the Container trouble PR #165's Preview check found. Run 2026-10-24 to 26. The code is in `spikes/coder-on-workerd/` on the [`prototype/coder-on-workerd`](https://github.com/chengchao/hopon/tree/prototype/coder-on-workerd) branch, kept off `main`. It ran locally under `wrangler dev`, then on throwaway deployed Workers (`hopon-coder-spike`, `hopon-pi-coder-spike`), which are now deleted. No production code changed.

**Question:** Can one Durable Object per Draft run pi's agent loop itself on workerd, with its sandbox a Cloudflare Container it controls through the Durable Object Container API (`ctx.container.start()` / `exec()`, `scheduling_policy: "durable_object"`)? That would drop both today's Coder Container and the E2B box.

**Short answer: yes, locally and on Cloudflare.** `pnpm -F worker smoke:coder` ended `done` with its files every time: a new game, a music build, and a new game followed by a change on the same box. Every playtest was green.

- `apps/maker/src/coder.ts`'s `runJob` ran **unchanged** inside a plain SQLite `DurableObject`.
- Its box was `image/build.ts`'s environment, driven by `exec()` through a 150-line stand-in for the slice of E2B's `Sandbox` that `runJob` and `ops.ts` use.
- On Cloudflare, a job's Durable Object used **0.4–1.4 s of CPU**. The Worker started in **159–198 ms**, against a 1 s limit.
- A box accepted `exec()` **150–250 ms** after `start()`, and Chromium was up in 3.2–9.0 s (median about 4.6 s). Playtests took **7.0–11.3 s**, against E2B's 5.6–6.4 s, and a box twice the size didn't make them faster.

Five things break on workerd. Each has a small fix, listed in [What breaks on workerd](#what-breaks-on-workerd). The fallback (step 3: pi in a container of its own, the box in a separate Box Durable Object) isn't needed.

**A second Coder on pi-durable** (the Talker's harness, set up as Cloudflare's Pi harness docs show) is the better choice, as long as the eval agrees. It finishes a job across a restart, where the pi-coding-agent Coder starts over. It needs none of the workarounds, and its bundle is a quarter of the size. See [pi-durable instead of pi-coding-agent](#pi-durable-instead-of-pi-coding-agent).

## What was built

- **`spikes/coder-on-workerd/src/index.ts`**: a Worker and a `Coder extends DurableObject`, named by the Draft's id. It serves the same `/__coder/:draftId/jobs/:jobId` and `DELETE …/box` routes that `coder-smoke.mjs` already calls. Deployed, every route sits under `/t/<SPIKE_TOKEN>/`, so nobody else could spend the model key.
  - On a job, it writes `agent-home` (bundled as Text modules) into `/tmp`, starts the box if it isn't running, and points `routeModels` at `modelFetch` directly. There's no `models.internal` outbound handler: the key lives in the Durable Object's `env`.
  - Then it runs `runJob` with Haiku 5.5 at low effort and streams the events as NDJSON.
- **`spikes/coder-on-workerd/src/box.ts`**: `commands.run` (foreground, or background with streamed stdout and stderr, `kill()` and `wait()`), plus `files.read`, `write`, `exists` and `makeDir`, all over `ctx.container.exec`. It adapts to how `exec()` works:
  - `exec()` has no shell, so commands go through `bash -lc`.
  - It inherits no env but `PATH`, so `HOME` and `PLAYWRIGHT_BROWSERS_PATH` are passed on every call.
  - It has no timeout, so a timeout is `AbortSignal.timeout`; an abort sends SIGKILL.
  - Exit codes come from `proc.exitCode`. A non-zero exit throws `{stdout, stderr, exitCode}`, as E2B's `CommandExitError` does.
  - Writes pipe the content into `cat > file` over stdin.
- **The box image, two ways:**
  - **Locally**, `spikes/coder-on-workerd/box/Dockerfile`: `image/build.ts` as a Dockerfile. It's `node:24` with ffmpeg, esbuild, playwright-core with chromium-headless-shell, typescript and `/opt/hopon/*`, running as `user` (uid 1001) in `/workspace`. `CMD node /opt/hopon/browser.js` starts Chromium on :9222, as the template's start command did. The image is 1.97 GB.
  - **Deployed**, a snapshot. Pushing that image from this Mac failed twice: Docker Desktop lost DNS for the registry, and then the registry login expired during the upload. So `POST /setup` built the box on Cloudflare without Docker:
    - It started Cloudflare's managed `cloudflare/debian-trixie` image (Node 24.22.1) with internet on.
    - It ran `build.ts`'s steps over `exec()`: apt ffmpeg (58 s), npm (7.5 s), Chromium (24 s), `/opt/hopon/*` and the user.
    - It snapshotted the result: 625 MB in 22.9 s.
    - Every box then booted from that snapshot with `enableInternet: false` and `entrypoint: ["node", "/opt/hopon/browser.js"]`.
- **`wrangler.jsonc`** (wrangler 4.152.0): `containers[].scheduling_policy: "durable_object"`, no `max_instances`, `limits.cpu_ms: 300000`, and two `define`s explained below. The box starts with `instance: { vcpu: 2, memoryMib: 6144, diskMb: 6000 }`.
  - Locally the config has `images.box.dockerfile`; deployed it had no `images` and used `BOX_SNAPSHOT`.
  - `wrangler dev` builds the image, and `start`, `exec`, `getTcpPort` and `destroy` all work locally. `snapshotContainer` doesn't, as noted under [Snapshots](#snapshots).

## What breaks on workerd

In the order the spike hit them:

1. **`import.meta.url` is undefined in a bundled Worker.** pi-coding-agent's `config.js` runs `fileURLToPath(import.meta.url)` at import, so the Worker fails to start. About 15 more `createRequire(import.meta.url)` and `new URL(…, import.meta.url)` sit in pi, jiti, quickjs-wasi and photon paths.
   - Fix: wrangler `define: { "import.meta.url": "\"file:///bundle/index.js\"" }`.
   - This changes the whole bundle, which is one reason to keep the Coder out of the Talker's Worker.
2. **`import.meta.dirname` is undefined.** So `coder.ts`'s `AGENT_HOME` doesn't resolve.
   - Fix: `define` it to `/tmp/maker/src`. Bundle `AGENTS.md` and the four `SKILL.md` as Text modules, and write them to `/tmp/maker/agent-home` at the start of each job.
   - workerd's `/tmp` lives for one request. `mkdtempSync`, `cpSync` and pi's `DefaultResourceLoader` all work on it.
3. **Every tool call fails with "Code generation from strings disallowed for this context".** pi-ai's `validateToolArguments` compiles each tool's schema with TypeBox's `Compile`, which uses `new Function`. TypeBox checks whether eval works once and caches the answer. The check runs during startup, where workerd allows eval, but the compile runs inside a request, where workerd forbids it.
   - The tool never runs, the model just sees an error. The first smoke runs ended "never playtested" with every `write`, `bash` and `playtest` call taking 0–1 ms.
   - Fix: `Settings.Set({ useAcceleration: false })` from `typebox/system` at module load. TypeBox then uses its interpreted checker.
4. **An `exec()` process with unread output never reports its exit.** `cat` of a missing file wrote to a stderr nobody read, and `proc.exitCode` never resolved, which hung the job.
   - Fix: always drain stdout and stderr, or pass `"ignore"`.
5. **pi's `read` drops every image.** pi decodes images with photon: WASM loaded through `fs.readFileSync`, run in a `worker_threads` Worker, with an in-process fallback. None of that loads on workerd.
   - So `read` of even a 360×640 PNG returns "Image omitted: could not be resized below the inline image size limit".
   - Fix: pass `autoResizeImages: false` to `createReadToolDefinition` in `ops.ts`. With it, the PNG comes through (checked in the spike).
   - The playtest tool's screenshots never went through `read`, and they reached the model fine.

**Didn't break:**

- pi-tui, jiti, cross-spawn and `child_process` are imported but never called with `noTools: "builtin"`, `noExtensions` and our own `operations`.
- `SessionManager.inMemory` and `SettingsManager.inMemory` work.
- `routeModels`' global `fetch` patch and `abortable()` work.
- The `e2b` SDK bundles and loads, though it's dead code here.

One more change for production: `routeModels` patches the isolate's global `fetch`, and one isolate hosts many Durable Objects. Two Drafts' jobs in one isolate would share the last job's handler and its `draftId` and `jobId` tags. Production should carry the job through `AsyncLocalStorage` (workerd has it) instead of a module global.

## Bundle and limits

|  | Spike Coder Worker | Limit |
| --- | --- | --- |
| Bundle | 14,760 KiB, 2,728 KiB gzipped | 64 MiB uncompressed on Paid; no compressed limit |
| Startup | **159–198 ms** on Cloudflare (4 deploys); 549 ms active in the local profile | 1 s |
| CPU per job, Durable Object request (tail `cpuTime`) | **390 ms** plain (37 s wall), 613 and 446 ms for a new game then a change (28 s and 26 s), **1,363 ms** with music (67 s) | 30 s default per request, 300 s with `limits.cpu_ms` |
| Isolate memory | not measured | 128 MB, shared by the Durable Objects in an isolate |

- **CPU is a non-issue.** pi spends its time waiting on the model and the box. In Node the same jobs measured 1.75–1.83 s, E2B SDK included.
- **Startup** fits on its own. Most of it is pi-coding-agent's `index.js` pulling in interactive mode (themes, mermaid, pi-tui) at import. ADR 0003 puts the Talker's bundle at 965 KiB gzipped.
  - A Coder Worker of its own, bound by `script_name`, keeps the two from adding up and keeps the `define`s out of the Talker's code.
- **Wall time** has no Durable Object limit while the request is open. The job runs inside one `fetch` and its `waitUntil`.

## Timings on Cloudflare

All jobs below ended `done` with green playtests. The model was Haiku 5.5 at low effort. The box was booted from the snapshot, 2 vCPU / 6 GiB unless noted.

| Job | Box up (exec, then Chromium) | Durable Object wall | Steps | Playtests | Model $ |
| --- | --- | --- | --- | --- | --- |
| smoke (new game) | 0.15 s, 3.5 s | 36.0 s | 4 | 7.6 s | $0.0050 |
| smoke `--music` (music.js 417 KB, render 3.0 s) | 0.24 s, 4.7 s | 65.5 s | 6 | 9.8 s | $0.0088 |
| new game, then a change on the same box | 0.19 s, 3.3 s; then already running | 27.5 s, then 24.8 s | 3, then 4 | 8.1 s; 8.2 s | $0.0038, $0.0045 |

One fixed game (`eval/revisions/stacker`) through `POST /timing`:

|  | Box up: exec, then Chromium on :9222 | Playtest (3 runs) | After a snapshot and restore |
| --- | --- | --- | --- |
| 2 vCPU / 6 GiB, run 1 (first boot of a new snapshot) | 11.7 s, 15.4 s | 10.4, 7.3, 7.2 s | exec 1.4 s, Chromium 4.0 s, playtest 10.3 s |
| 2 vCPU / 6 GiB, run 2 | 0.26 s, 4.6 s | 11.3, 8.1, 8.9 s | exec 1.6 s, Chromium 5.2 s, playtest 12.1 s |
| 2 vCPU / 6 GiB, run 3 | 0.16 s, 9.0 s | 9.7, 7.3, 7.2 s | exec 1.5 s, Chromium 8.1 s, playtest 9.1 s |
| 4 vCPU / 12 GiB | 0.22 s, 7.7 s | 8.0, 7.5, 7.0 s | exec 1.4 s, Chromium 4.5 s, playtest 9.6 s |
| E2B `hopon-maker` (2 vCPU, 2 GiB), for comparison | create 2.1 s, Chromium warm in its snapshot | 6.4, 5.9, 5.8 s | pause 0.27 s, resume 0.19 s, then 5.6 s |

Across all 10 cold boots after the first, the box took 146–255 ms to `exec`-ready and 3.2–9.0 s to Chromium (median about 4.6 s).

- **Cold start** is fast, but Chromium then starts from scratch, where E2B's memory snapshot keeps it warm.
  - The very first boot of a newly made 625 MB snapshot took 11.7 s, presumably while it reached the host. Cloudflare says placement favors hosts that already have the image or snapshot ([blog](https://blog.cloudflare.com/faster-agent-sandboxes/)).
  - The spike waited for :9222 before the job began. It doesn't have to: `helpers.js` already falls back to `chromium.launch()` when it can't connect. A readiness check on `exec()` alone would let Chromium start while the model reads the skills and writes the game, which took at least 20 s before the first playtest in every job above.
- **Playtests are about 1.5–2 s slower than E2B's**, and doubling the vCPU didn't change that. So it isn't CPU. Cloudflare's run is mostly `playtest.js`'s fixed waits, as E2B's is; I didn't find where the rest goes.
  - The first playtest after a boot is slower again (9.7–11.3 s), because `browser.js`'s typecheck and render warm-up are still running. E2B's snapshot holds them warm.
- **`exec` overhead is small:** a file write took 21–37 ms deployed, and `find -delete` 38 ms.
- **Client-side stalls.** Four of the `/timing` calls and one smoke stream from this Mac got no bytes back, or got cut off with `ECONNRESET`.
  - None of them left a tail event, not even the outer Worker's, while every call that worked did.
  - This Mac's network was flaky all session: Docker Desktop lost DNS, and wrangler API calls hung. So I put these down to the client, but that isn't verified.
  - The Talker calls the Coder from inside Cloudflare, so it shouldn't see these. Worth watching in a staging run.

### Snapshots

- `snapshotContainer()` saves the root filesystem only, with no memory and no processes ([docs](https://developers.cloudflare.com/durable-objects/api/container/)). A restored box runs its entrypoint again, so Chromium starts from scratch.
- A snapshot of a box booted from a snapshot is **incremental**: 117–205 KB, taking 3.5–4.7 s. It held the workspace (`game.ts` was there after restore).
- A restored box took 1.4–1.6 s to `exec`, slower than a boot from the base snapshot (0.15–0.25 s). Its Chromium was up in 4.0–8.1 s.
- **They don't replace E2B's pause, and they aren't needed for it.** Every job rewrites the workspace from its own `source` (`restore` in `coder.ts`), so a box fresh from the image is as good as a restored one.
- What replaces pause is keeping the box running between turns with `setInactivityTimeout` (up to 6 h), or stopping it after each job and paying about 0.2 s plus Chromium. That's a cost trade-off, covered next.
- **They can build the box without Docker.** That's what the deployed run did. But a snapshot is tied to the image it came from and expires 30 days after its last restore, and there's no list or delete method.
  - Production should ship the Dockerfile image through `wrangler deploy`, as `images.box`.
  - The spike's snapshots are left to expire.
- Under `wrangler dev`, snapshots fail: workerd's `docker commit` gets `400 invalid JSON: got EOF` from this Mac's Docker Engine 23.0.5.

## Cost per game

Containers bill active CPU at $0.000020 per vCPU-second, and memory at $0.0000025 per GiB-second and disk at $0.00000007 per GB-second for as long as the instance runs ([pricing](https://developers.cloudflare.com/containers/pricing/)). A custom instance needs at least 3 GiB per vCPU ([limits](https://developers.cloudflare.com/containers/platform/limits/)), so E2B's 2 vCPU / 2 GiB becomes **`{ vcpu: 2, memoryMib: 6144, diskMb: 6000 }`**. `standard-3` (2 vCPU, 8 GiB, 16 GB) also fits, and 4 vCPU bought nothing.

| Per build (the deployed jobs ran 25–66 s; 60 s here) | Custom 2 vCPU / 6 GiB |
| ---------------------------------------------------- | --------------------- |
| CPU, at most 2 vCPU busy all 60 s                    | ≤ $0.0024             |
| Memory                                               | $0.0009               |
| Disk                                                 | < $0.0001             |
| **Box, stopped after the job**                       | **≤ $0.0033**         |
| Kept up 2 min more for the next turn (memory)        | + $0.0018             |

- That's within ADR 0003's "a cent of sandbox time" per game on E2B, before Cloudflare's included 375 vCPU-minutes and 25 GiB-hours a month.
- Dropping the Coder Container saves its `basic` instance for each job plus its 2 min `sleepAfter`, about $0.0005 a build.
- The Coder Durable Object adds about $0.0001 a build: about 7.7 GB-s of duration, and 0.4–1.4 s of CPU.
- Active CPU in the box wasn't measured, so the CPU line is a ceiling.

## pi-durable instead of pi-coding-agent

Run 2026-10-25 under `wrangler dev`, after the deployed run, following [the Pi harness docs](https://developers.cloudflare.com/agents/harnesses/pi/) and [their extensions page](https://developers.cloudflare.com/agents/harnesses/pi/extensions/). Code: `spikes/coder-on-workerd/src/pi-coder.ts`, served under `/t/<token>/pi/__coder/…`, so `smoke:coder` runs it with `CODER_URL=…/t/local/pi`.

**How it's built.** It follows the docs' shape, with one Durable Object per Draft, as today:

- A plain `DurableObject` with `Lifecycle.install(this).use(this.harness)`, and the registry as a class field.
- `PiHarness` opens `Harness.open()` with the Talker's way of reaching the model: pi-ai's Anthropic API with a per-request `fetch` that calls `modelFetch`.
- pi-durable's own `CodingTools` (`read`, `write`, `edit`, `bash`). They reach the box through `Harness.open`'s `env`: an `ExecutionEnv` over `ctx.container.exec`.
  - The four tools call nine of its methods (`absolutePath`, `joinPath`, `canonicalPath`, `exists`, `fileInfo`, `openBinaryReader`, `readTextFile`, `writeFile`, `exec`), about 200 lines.
- The skills come through agents' `skills(fromManifest(...))`, which adds the `activate_skill` and `read_skill_resource` tools. `AGENTS.md` is a prompt section, with its "read the skill with the read tool" line pointed at `activate_skill`.
- `playtest` is a `defineTool` with `replay: "safe"`: it plays the workspace as it is, so running it twice is harmless.
- A `ToolTask` `beforeTool` hook keeps the 12-step limit: it blocks the 13th call and aborts the run.
- A `GenerationTask` `onYield` hook runs the job's ending (music render, files read back) inside pi's run.
- The job id is the submission's `operationId`, so a re-POST of the same job attaches to it.
- The job's limits, playtests and final event live in the object's SQLite (`ctx.storage.kv`).
- The box gets `setInactivityTimeout(10 min)`, so it outlives an idle or restarted object.

|  | pi-coding-agent Coder | pi-durable Coder |
| --- | --- | --- |
| **Worker reloaded mid-job (what a deploy does), then the job re-POSTed** | Starts over from scratch: "Reading the docs" again. That run then failed "never playtested", likely with the first run's processes still in the box. | Resumes where it was. It ended `done` in 4 of 5 runs, and 2 of 2 after the fix below. With 45 s and nobody connected, pi finished the game, the music and the ending on its own (its alarm restarted the object), and the re-POST got the stored result at once. |
| Plain builds, same session | 4 of 4 `done`, 42–61 s, 3–5 steps, 0.53–0.78¢ | 7 of 7 `done`, 28–50 s, 3–4 steps, 0.29–0.42¢ |
| Music builds | 2 of 2 `done` (49 s, 78 s) | 4 of 6 the model could finish were `done` (the restart runs count). One went over 12 steps, one wrote 42.7 s of music (the cap is 40 s). |
| Workarounds needed on workerd | All five (`define`s, TypeBox setting, drained streams, `autoResizeImages: false`), plus moving `routeModels`' global `fetch` to per-job state | Only draining the box's streams, which is about `exec()`, not pi. `read` sends PNGs as they are, with no Photon. The model's `fetch` is per request. |
| Bundle | 14.4 MB, 2.6 MB gzipped | **3.6 MB, 753 KB gzipped**, including `agents/skills`' peers |
| Startup, local profile | 549 ms active | **56 ms** active |
| Versions | pi-coding-agent 1.3.0 (today's) | `agents` 0.30.1 and Pi 1.4.0, the docs' minimum. The repo pinned `agents` 0.28.1 and Pi 1.3.0 then; [#172](https://github.com/chengchao/hopon/issues/172) upgrades it. |

**What it found:**

- **A durable run needs a durable ending.** The first restart test failed even though pi finished the game on its own. The ending ran in the HTTP handler, and the box had shut down once the object went idle, so the re-POST got an empty box.
  - Fix: run the ending in the `onYield` hook and keep the box with `setInactivityTimeout`.
  - A run that is stopped (deadline, step limit, cancel) never yields, so the handler still ends that one.
- **pi-durable needs no TypeBox workaround.** With pi-coding-agent's `Settings.Set` switched off for pi-durable's copy of TypeBox (confirmed in the bundle), both builds ended `done`.
  - It also showed a trap: two copies of TypeBox 1.3.27 are bundled. My first rerun of the pi-coding-agent Coder failed 6 of 6, because its setting reached the wrong copy.
- **`agents/skills` pulls in optional peers.** It imports `ai`, `@cloudflare/codemode` and `just-bash` for running skill scripts, which we never use. They're inside the 753 KB. A prompt section and one small `read_skill` tool would avoid them.
- **pi-durable's tools are not pi-coding-agent's.** `edit` takes an array of `oldText`/`newText` pairs, and `read` pages files by line.
  - The model coped in every build.
  - The 2 music failures are the kind the eval counts, and 12 builds say nothing about the pass rate. #116's eval ran 72.

**Not measured:** CPU per job on Cloudflare (pi-durable writes a checkpoint at every step), a real deploy instead of a dev reload, and the eval.

**Verdict:** pi-durable is the better choice for the Coder.

- It's the only one of the two that survives an eviction or a deploy mid-build.
- It's the Talker's own stack, it runs on workerd without workarounds, and it's a quarter of the size.

What has to happen first:

1. Upgrade `agents` to 0.30 and Pi to 1.4. The Talker shares them, so re-run its eviction and snapshot checks, as ADR 0003 asks for every upgrade.
2. Run the Coder eval on the pi-durable Coder, and switch only if it holds #116's pass rate.

## Cloudflare Sandbox 1.0

Read 2026-10-25: [Sandboxes](https://developers.cloudflare.com/sandbox/), [the coding agent runner](https://developers.cloudflare.com/sandbox/get-started/build-a-coding-agent-runner/), [`@cloudflare/sandbox`](https://developers.cloudflare.com/sandbox/reference/), [Sandbox lifetime](https://developers.cloudflare.com/sandbox/concepts/lifetime/), and [Sandbox in the Agents SDK](https://developers.cloudflare.com/agents/tools/sandbox/).

**A "sandbox" is now what this spike already built:** a Durable Object that controls its container through `ctx.container` under the `durable_object` policy.

- Sandbox SDK 0.x, the `Sandbox` class with its own runtime in the image, is the legacy path.
- `@cloudflare/sandbox` 1.x (1.0.3, 134 KB, depends on `zod` and `aws4fetch`) no longer starts or stops anything. It is three helper classes: `Files`, `S3Mount` and `DirectoryBackup`. They run a static `sandbox-shim` binary in the container through `exec()`, so the image needs `COPY --from=docker.io/cloudflare/sandbox:<version> /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim`.
- For an agent whose loop runs in a Durable Object, Cloudflare's own pointer is the Agents SDK's Sandbox page. There, the model's tool calls `exec()` in the agent's attached container, which is the pi-durable Coder's shape.

**What the spike should take from it:**

- **Set the inactivity timeout in the constructor too.** "The timeout does not survive a restart": a restarted object starts without one, so the box stops shortly after the object goes idle. The pi-durable Coder sets it only after `start()`.
  - Its restart tests passed because pi's 30-second heartbeat alarm kept the object active until the run ended. After a deploy, though, the box would not wait for the next turn.
  - Every example sets it again in the constructor (`if (ctx.container?.running) ctx.blockConcurrencyWhile(() => container.setInactivityTimeout(...))`).
- **A deploy keeps the box running.** "A running instance keeps running, and the next request reaches the same instance, with its files and processes." That answers the open question about Coder deploys.
- **Code inside the box doesn't keep it alive.** Only the object's activity does (requests, streamed responses, alarms). pi-durable's heartbeat alarm covers a run.
- **Kill the whole command, not just its first process.** The Agents SDK example runs `timeout --kill-after=5 60 bash -lc <command>`, which stops every process the command started. That closes production change 5.
- **A piped process gets `SIGPIPE` once the request that started it ends.** A `bash` call in flight when the object restarts dies with it. pi-durable doesn't replay `bash` anyway, but background work belongs in `setsid` plus log files, as the runner does.
- **`Files` could replace the hand-made file operations** in `box.ts` and `boxEnv`: `cat`, `stat` parsed from text, writes piped through `cat`, and "not found" guessed from stderr.
  - It offers `readFile` (streamed), `writeFile`, `stat`, `readDirectory`, `mkdir`, `rename` and `remove`, with typed errors (`SandboxFileError` with `ENOENT` and the like).
  - The cost is the shim in the image and a package whose version must match the image tag.

**Tried 2026-10-25, under `wrangler dev`:**

- **The setup.**
  - The box image copies `sandbox-shim` from `cloudflare/sandbox:1.0.3`, matching `@cloudflare/sandbox` 1.0.3.
  - In the pi-durable Coder's `boxEnv`, these now go through `Files`: `readFile`, `writeFile` (after a recursive `mkdir` of the parent), `stat`, `lstat`, `readDirectory`, `mkdir`, `rename` and `remove`. `SandboxFileError` codes map to pi-durable's (`ENOENT` → `not_found`, `EISDIR` → `is_directory`, and so on). The playtest screenshots are read with `Files` too.
  - `realpath`, append and truncate have no `Files` method and stay on `exec()`.
  - `bash` with a timeout runs under `timeout --kill-after=5 <s>`.
  - The constructor sets the inactivity timeout again when the box is already running.
  - The E2B-shaped `box.ts`, used by the pi-coding-agent Coder and by the job's restore and ending, still uses `cat`.
- **Smoke: 5 of 5 `done`.** 3 plain (43–75 s; one needed 3 playtests and 11 steps, so `read`, `edit` and `write` ran many times through `Files`) and 2 music (61 s, 78 s).
- **Restart tests: 2 of 2 `done`,** re-POSTed after 8 s and after 45 s. In both, the next turn, sent after 90 s of idle, found the same box still running and ended `done`.
- **The constructor timeout couldn't be shown to matter locally.** A control run with it switched off also kept the box through the restart and 90 s of idle.
  - That fits the docs: the box "keeps running for the inactivity timeout that the previous version set", here the 10 minutes set when the job started.
  - The earlier failure came from a box that never had a timeout set.
  - The constructor still matters once the inherited timeout runs out. That was shown on Cloudflare: see [pi-durable on Cloudflare](#pi-durable-on-cloudflare).
- **Bundle:** `@cloudflare/sandbox` adds about 23 KB gzipped. The pi-durable Coder alone is now 3.7 MB, 776 KB gzipped.
- **Also fixed:** a re-POST used to get the final event twice, once from the `onYield` hook and once from the handler. Each stream now sends one.

## pi-durable on Cloudflare

Run 2026-10-26 as the throwaway Worker `hopon-pi-coder-spike`: the pi-durable Coder alone (`wrangler.pi.jsonc`), with its box built from `box/Dockerfile`, `sandbox-shim` included. This time the image push from this Mac worked (264 s). Deleted afterwards: the Worker, its container app (with 3 boxes still running), and both image tags.

|  | Result |
| --- | --- |
| Startup | **38–42 ms** (4 deploys), against 159–198 ms for the pi-coding-agent Coder |
| Smoke | 4 of 5 `done`: plain 2 of 3 (29 s, 72 s; one over 12 steps), music 2 of 2 (58 s, 85 s) |
| CPU per job | About 5.1 s across 4 jobs, so about 1.3 s each. It's split between the job's HTTP request and pi's heartbeat alarms (each about 30 s of wall time). No single invocation went over 1.02 s. |
| Box ready for `exec()` | 0.3–0.5 s, but 13.3 s and 20.6 s on two first boots, presumably while the 1.97 GB image reached a new host |

**A deploy mid-game doesn't restart anything.** Every event of the job, including the alarm that finished it, ran on the old version. Cloudflare lets a busy object finish its work on the previous code, as the [lifecycle docs](https://developers.cloudflare.com/sandbox/concepts/lifetime/#deploys-keep-instances-running) say. The new version first started with the next request.

- So a deploy doesn't test resuming, and the earlier "reload" tests under `wrangler dev` were harsher than a real deploy.
- The pi-coding-agent Coder's job, which runs in a request's `waitUntil`, likely gets the same grace. Not tested.

**A crash mid-game, forced with `ctx.abort()`** (a spike-only `/crash` route, the way a crash or an eviction resets the object). Four runs:

- In all four, the next heartbeat alarm restarted the object, pi resumed, and the re-POST re-attached to the same running box.
- **2 ended `done`.**
- **1 failed "over 12 steps".** The model was fighting a type error, not the restart.
- **1 hung.** After resuming, pi waited about 4 minutes, with heartbeats using about 1 ms of CPU each. Then Cloudflare reported "Internal error in Durable Object storage caused object to be reset". The re-attach found the job past its deadline, and it ended `failed`. It didn't happen again, and that run had no tool logging, so the cause is unknown.

**The constructor's timeout matters, shown on Cloudflare.** The box started with a 60 s inactivity timeout (`BOX_START_IDLE_MS`). After the crash and the job, the next turn came 3 minutes later:

- with the constructor setting 10 minutes again, it found the **same box** running;
- with the constructor's timeout off (`NO_CTOR_TIMEOUT`), it got a **new box** (538 ms).

## Skills in pi-durable on Cloudflare

Run 2026-10-26: under `wrangler dev`, then on the deployed `hopon-pi-coder-spike`, since deleted. The question was whether pi-durable running in a Durable Object can use the Coder's skills.

**How skills reach the model here.**

- agents' `skills(fromManifest(...))` takes the four `SKILL.md` files, which are bundled into the Worker, and adds a `skills` prompt section. That section lists only each skill's name and description, under "When a task matches a skill, use activate_skill with its name before proceeding."
- The model calls `activate_skill({ name })`, and the tool's result is that skill's full text, served from the Worker's memory. Nothing is read from disk or from the box.
- (pi-coding-agent instead lists skill file paths, which its `read` tool opens. That's why that Coder needed them written to `/tmp`.)

**What was checked.** An `afterTool` hook records every `activate_skill` call: the skill's name, the length of the text returned, and its first heading. The record is kept in the object's storage and sent on the job's stream.

**A probe** (`POST …/skills`). A fresh conversation is asked to list the skills it's offered, load `dom-games` and `zzfx`, and quote each one's first heading.

- 1 of 1 locally and 2 of 2 on Cloudflare: the model named all four skills and loaded the two asked for.
- Each call returned the whole skill: 6,997 and 2,168 characters, the files without their frontmatter.
- The model quoted both headings exactly, so their text reached it.

**Builds that pick their own skills**, on Cloudflare:

| Build | Skills it loaded | Result |
| --- | --- | --- |
| A planet quiz (plain DOM) | `dom-games` (6,997 chars) | `done`, 54 s |
| Star Catcher with music (LittleJS) | `littlejs-api` (21,736 chars), then `music-synth` (3,569 chars) | `done`, 56 s, with `music.js` |
| Pair Up memory game (plain DOM) | `dom-games` (6,997 chars) | `done`, 45 s |

So yes: on Cloudflare, pi-durable offers the skills, the model loads the right one for the game, the whole text comes back, and the games are built from it.

- `read_skill_resource` wasn't exercised: our skills have no extra files.
- `zzfx` was loaded only by the probe. No build asked for an extra sound.

**Cleanup.** The Worker and its container app are deleted. In the registry, this deploy reused the earlier image, and that image's manifests are gone (404). But two small artifacts attached to them remain in `hopon-pi-coder-spike-picoder-box`: the registry refuses to delete them (`409 SINGLETON_ARTIFACT_EXISTS`), and `wrangler containers images delete` accepts only `image:tag`.

## What ADR 0003 would change

- **The Coder** becomes a plain SQLite Durable Object per Draft, running pi-coding-agent on workerd. It's no longer a `@cloudflare/containers` `Container` running `apps/maker/src/server.ts`.
  - Cloudflare maintains the `Container` class only "through December 31, 2026" ([blog](https://blog.cloudflare.com/faster-agent-sandboxes/)), so it needs replacing anyway.
  - The Coder holds the model key in `env` and calls `modelFetch` itself. The `models.internal` outbound handler goes.
  - It should get its own Worker, for the `define`s and so the Talker and the Coder don't share a startup budget.
  - A finished job's final event can now live in the object's SQLite. That removes server.ts's ponytail note about the in-memory record and a double build after the container sleeps.
- **The box** becomes a Cloudflare Container the Coder starts with `ctx.container.start({ image, enableInternet: false, instance })` under `scheduling_policy: "durable_object"`. Its image is `image/build.ts` turned into a Dockerfile, deployed by the same `wrangler deploy`.
  - Gone: E2B, `E2B_API_KEY`, the E2B team's 20 running boxes and the template build in `deploy`.
  - Gone too: `max_instances` (that policy refuses it) and with it the `busy` failure and the 18 plus 2 split.
  - Gone: application-wide rollouts. A running box keeps its image until our code restarts it.
  - A global cap on running builds becomes ours to keep ([#34](https://github.com/chengchao/hopon/issues/34)). The account allows 1,500 concurrent vCPU by default, which is 750 boxes at 2 vCPU.
- **Between turns:** E2B's pause and resume (0.2 s, Chromium warm) becomes a running box with an inactivity timeout, or a cold start of about 0.2 s plus Chromium's 3–9 s. The cold start hides behind the model's first turns if the job doesn't wait for Chromium.
- **Playtests are about 1.5–2 s slower than on E2B.** That's 2–4 s on a typical build's one or two playtests, inside the 120 s deadline (the eval's median build is 62 s).
- **Isolation.** ADR 0003 picked E2B over "Docker on a server we run" because a container isn't a VM boundary. Cloudflare's new runtime restores a prepared virtual machine for each Container ([blog](https://blog.cloudflare.com/faster-agent-sandboxes/)). The docs also note that under this policy, `exec`'s `user` "doesn't restrict the process's capabilities". The box still holds no secrets and has no internet.
- **Deploys.** A code deploy restarts the Coder Durable Object. In-flight requests "may finish if they don't access the object's storage" ([lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)); a running job touches none. Whether the box keeps running across that restart wasn't checked. The Talker's re-attach by job id still covers a cut job.
- **The rest stands:** the Talker, the contract, `runJob`, the skills, the playtest, music, the 120 s and 150 s deadlines.
- **Revisit when:** a pi upgrade comes. Re-run the spike's checks: module load, a tool call, a PNG `read`.

## Code changes production would need

The spike worked around these without touching production code:

1. Settings in the Coder Worker:
   - `Settings.Set({ useAcceleration: false })` (TypeBox);
   - `define` for `import.meta.url` and `import.meta.dirname`, or a `cwd` for agent-home that `coder.ts` takes as a parameter;
   - `agent-home` as Text modules, written to `/tmp` per job.
2. `ops.ts`: `read: { autoResizeImages: false, operations }`.
3. A small `Box` interface (`run`, `read`, `write`, `exists`, `mkdir`) in place of E2B's `Sandbox` type, implemented over `exec()`. `spikes/coder-on-workerd/src/box.ts` fakes E2B's type so `runJob` stays untouched.
4. A per-job model handler through `AsyncLocalStorage` instead of `routeModels`' module global.
5. On abort, kill the whole process tree, not just the exec'd process. `exec`'s `signal` SIGKILLs the process it started, and `bash -lc 'a; b'` leaves children. Not tested.
6. A box sized `{ vcpu: 2, memoryMib: 6144, diskMb: 6000 }`, a readiness check on `exec()` rather than :9222, and `setInactivityTimeout` for how long a box waits for the next turn.
7. Ship the box image from CI rather than a laptop. This Mac's Docker Desktop couldn't push it: the 1.97 GB `node:24` image is about four times today's Coder image. A `node:24-slim` base with Playwright's dependencies would shrink it; that build was started but not finished.

## Still open

- **Memory:** the 128 MB per isolate is shared by every Coder in it. A job holds its transcript with base64 screenshots and up to 438 KB of `music.js`. Not measured.
- **Where the playtest's extra 1.5–2 s goes.**
- **Whether the box survives a Coder deploy**, and what the Talker sees from inside Cloudflare (the client-side stalls above).

## How to run it

```bash
pnpm -F maker build:runtime
```

```bash
cd spikes/coder-on-workerd && npm install --no-package-lock wrangler@4.152.0 && npm approve-scripts workerd esbuild && npm rebuild workerd esbuild
```

Then link pi-ai, pi-coding-agent and typebox into the spike's `node_modules`, because its `src/probe.ts` imports them by name: `ln -s` each from the pnpm store. Also copy `apps/maker/image`'s eight box files to `box/files/<name>.txt` (gitignored). Put `CLOUDFLARE_API_KEY` from the main checkout's `apps/maker/.env`, and `SPIKE_TOKEN=local`, in `.dev.vars`, and start Docker.

```bash
node_modules/.bin/wrangler dev --port 8798
```

```bash
CODER_URL=http://localhost:8798/t/local pnpm -F worker smoke:coder
```

`?fake` on a job route runs pi against an in-memory box with no container. `POST /t/<token>/__coder/:id/selftest`, `/probe` and `/readpng` exercise the box adapter, every pi tool, and a PNG `read`. `/timing` runs the box timings above, and `/setup` builds the snapshot box.

To deploy: remove `images` from `wrangler.jsonc` and set the `CLOUDFLARE_API_KEY` and `SPIKE_TOKEN` secrets. `POST /setup`, then redeploy with `--var BOX_SNAPSHOT:<id>`.
