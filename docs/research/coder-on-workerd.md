# The Coder on workerd, with its box as a Durable Object Container

Spike for the Container trouble PR #165's Preview check found. Run 2026-10-24 on branch `spike/coder-on-workerd`, code in `spikes/coder-on-workerd/`. No production code changed.

**Question:** Can one Durable Object per Draft run pi's agent loop itself on workerd, with its sandbox a Cloudflare Container it controls through the Durable Object Container API (`ctx.container.start()` / `exec()`, `scheduling_policy: "durable_object"`)? That would drop both today's Coder Container and the E2B box.

**Short answer: yes.** `pnpm -F worker smoke:coder` ran end to end under `wrangler dev` against the spike and ended `done` with its files: a new game, a music build and a follow-up on the same box, all with green playtests. `apps/maker/src/coder.ts`'s `runJob` ran **unchanged** inside a plain SQLite `DurableObject`. Its box was the E2B template rebuilt as a Dockerfile, driven by `exec()` through a 150-line stand-in for the slice of E2B's `Sandbox` that `runJob` and `ops.ts` use.

Five things break on workerd. Each has a small fix, listed in [What breaks on workerd](#what-breaks-on-workerd). The fallback (step 3: pi in a container of its own, the box in a separate Box Durable Object) isn't needed.

**Not measured, because nothing was deployed:**

- the cold start on Cloudflare's machines;
- playtest speed on Cloudflare's CPUs;
- snapshots (they fail locally on this Mac's Docker Engine 23);
- workerd's own CPU accounting;
- the 1 s startup limit as Cloudflare measures it.

A throwaway deployed Worker (`hopon-coder-spike`, ready as is) would answer all five. It needs the owner's go-ahead.

## What was built

- **`spikes/coder-on-workerd/src/index.ts`**: a Worker and a `Coder extends DurableObject`, named by the Draft's id. It serves the same `/__coder/:draftId/jobs/:jobId` and `DELETE …/box` routes that `coder-smoke.mjs` already calls.
  - On a job, it writes `agent-home` (bundled as Text modules) into `/tmp`, starts the box if it isn't running, and points `routeModels` at `modelFetch` directly. There's no `models.internal` outbound handler: the key lives in the Durable Object's `env`.
  - Then it runs `runJob` with Haiku 5.5 at low effort and streams the events as NDJSON.
- **`spikes/coder-on-workerd/src/box.ts`**: `commands.run` (foreground, or background with streamed stdout and stderr, `kill()` and `wait()`), plus `files.read`, `write`, `exists` and `makeDir`, all over `ctx.container.exec`. It adapts to how `exec()` works:
  - `exec()` has no shell, so commands go through `bash -lc`.
  - It inherits no env but `PATH`, so `HOME` and `PLAYWRIGHT_BROWSERS_PATH` are passed on every call.
  - It has no timeout, so a timeout is `AbortSignal.timeout`; an abort sends SIGKILL.
  - Exit codes come from `proc.exitCode`. A non-zero exit throws `{stdout, stderr, exitCode}`, as E2B's `CommandExitError` does.
  - Writes pipe the content into `cat > file` over stdin.
- **`spikes/coder-on-workerd/box/Dockerfile`**: `apps/maker/image/build.ts` as a Dockerfile. It's `node:24` with ffmpeg, esbuild, playwright-core with chromium-headless-shell, typescript and `/opt/hopon/*`, running as `user` (uid 1001) in `/workspace`. `CMD node /opt/hopon/browser.js` starts Chromium on :9222, as the template's start command did. The image is 1.97 GB.
- **`wrangler.jsonc`**: `containers[].scheduling_policy: "durable_object"` with `images.box.dockerfile`, no `max_instances`, `limits.cpu_ms: 300000`. It also has two `define`s, explained in the next section. The box starts with `enableInternet: false` and `instance: { vcpu: 1, memoryMib: 4096, diskMb: 6000 }`, which local dev ignores.

wrangler 4.152.0 runs all of this locally: `wrangler dev` builds the image, `ctx.container.images.box` resolves, and `start`, `exec`, `getTcpPort` and `destroy` work. The repo's wrangler 4.130 wasn't tried.

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
| Bundle | 14,370 KiB, 2,622 KiB gzipped | 64 MiB uncompressed on Paid; no compressed limit |
| Startup, local profile | 549 ms active of 932 ms | 1 s startup |
| pi's CPU per job (Node, E2B box) | 1.75 s plain (33.6 s wall); 1.83 s with music (76.9 s wall) | 30 s default per request, 300 s with `limits.cpu_ms` |
| Isolate memory | not measured | 128 MB, shared by the Durable Objects in an isolate |

- **Startup** is the tight one. Most of it is pi-coding-agent's `index.js` pulling in interactive mode (themes, mermaid, pi-tui) at import. ADR 0003 puts the Talker's bundle at 965 KiB gzipped, so the two in one Worker add up.
  - A Coder Worker of its own, bound by `script_name`, keeps each under the limit and keeps the `define`s out of the Talker's code.
- **CPU** was measured in Node with `process.cpuUsage()` around the same `runJob`, E2B SDK included, so it's an upper bound. It's small next to the limit: pi spends its time waiting on the model and the box.
- **Wall time** has no Durable Object limit while the request is open. The job runs inside one `fetch` and its `waitUntil`.

## Timings

Local numbers are from Docker Desktop on a 6-core Intel Mac, so they say little about Cloudflare's machines. E2B was measured the same day from the same Mac.

| Run | Box | Result | Job | Playtests | Model $ |
| --- | --- | --- | --- | --- | --- |
| smoke (new game) | cold, up in 10.4 s | `done`: index.html, game.ts, game.js | 39.6 s, 4 steps | 1: 9.5 s | $0.0044 |
| smoke `--music` | cold, 9.1 s | `done`, music.js 438 KB; render 3.0 s | 73.2 s, 6 steps | 1: 14.1 s | $0.0083 |
| new game, then change on the same box | cold 10.3 s, then already running | `done`, then `done` | 51.1 s, then 49.0 s | 11.8 s; 9.4 s, 10.1 s | $0.0053, $0.0062 |

Box start compared, on one game (`eval/revisions/stacker`):

|  | Box up | Playtest (3 runs) | Between turns |
| --- | --- | --- | --- |
| E2B `hopon-maker` (2 vCPU, 2 GiB) | create 2.1 s, Chromium warm in the snapshot | 6.4, 5.9, 5.8 s | pause 0.27 s, resume 0.19 s, then 5.6 s |
| Local box, `docker run --cpus=2` | Chromium on :9222 in 3.1 s | 19.8, 11.5, 9.3 s | none: stop, then cold start |
| Local box, `--cpus=1` | 4.1 s | 29.0, 13.1, 18.0 s | none |

- **Cold start.** Cloudflare reports a median start of 648 ms (p95 910 ms) for the new scheduling path ([blog](https://blog.cloudflare.com/faster-agent-sandboxes/)). It's measured without our image, and placement favors hosts that already have the image. Chromium starts on top of that.
  - The spike waited for :9222 before the job began. It doesn't have to: `helpers.js` already falls back to `chromium.launch()` when it can't connect. A readiness check on `exec()` alone would let Chromium start while the model reads the skills, which takes 3–20 s before its first playtest in every run above.
- **The first playtest is slower.** `browser.js`'s typecheck and render warm-up are still running at that point. E2B's snapshot holds them warm.
- **Snapshots don't replace E2B's pause.** `snapshotContainer()` saves the root filesystem only, with no memory and no processes ([docs](https://developers.cloudflare.com/durable-objects/api/container/)), so Chromium and the warm caches start again after a restore. And they buy nothing here: every job rewrites the workspace from its own `source` (`restore` in `coder.ts`), so a box fresh from the image is as good as a restored one.
  - Snapshots are tied to their image and kept 30 days.
  - Under `wrangler dev` they failed: workerd's `docker commit` got `400 invalid JSON: got EOF` from this Mac's Docker Engine 23.0.5.
- **What replaces pause** is keeping the box running between turns with `setInactivityTimeout` (up to 6 h), or stopping it after each job and paying the cold start. That's a cost trade-off, covered next.

## Cost per game

Containers bill active CPU at $0.000020 per vCPU-second, and memory at $0.0000025 per GiB-second and disk at $0.00000007 per GB-second for as long as the instance runs ([pricing](https://developers.cloudflare.com/containers/pricing/)). A custom instance needs at least 3 GiB per vCPU ([limits](https://developers.cloudflare.com/containers/platform/limits/)), so E2B's 2 vCPU / 2 GiB becomes **`{ vcpu: 2, memoryMib: 6144, diskMb: 6000 }`**. `standard-3` (2 vCPU, 8 GiB, 16 GB) also fits.

| Per build (≈60 s, the eval's median 62 s)     | Custom 2 vCPU / 6 GiB |
| --------------------------------------------- | --------------------- |
| CPU, at most 2 vCPU busy all 60 s             | ≤ $0.0024             |
| Memory                                        | $0.0009               |
| Disk                                          | < $0.0001             |
| **Box, stopped after the job**                | **≤ $0.0033**         |
| Kept up 2 min more for the next turn (memory) | + $0.0018             |

- That's within ADR 0003's "a cent of sandbox time" per game on E2B, before Cloudflare's included 375 vCPU-minutes and 25 GiB-hours a month.
- Dropping the Coder Container saves its `basic` instance for each job plus its 2 min `sleepAfter`, about $0.0005 a build.
- The Coder Durable Object's duration is about 7.7 GB-s a build, about $0.0001.
- Active CPU during a build wasn't measured, so the CPU line is a ceiling.

## What ADR 0003 would change

- **The Coder** becomes a plain SQLite Durable Object per Draft, running pi-coding-agent on workerd. It's no longer a `@cloudflare/containers` `Container` running `apps/maker/src/server.ts`.
  - Cloudflare maintains the `Container` class only "through December 31, 2026" ([blog](https://blog.cloudflare.com/faster-agent-sandboxes/)), so it needs replacing anyway.
  - The Coder holds the model key in `env` and calls `modelFetch` itself. The `models.internal` outbound handler goes.
  - It should get its own Worker, for the startup limit and the `define`s.
  - A finished job's final event can now live in the object's SQLite. That removes server.ts's ponytail note about the in-memory record and a double build after the container sleeps.
- **The box** becomes a Cloudflare Container the Coder starts with `ctx.container.start({ image, enableInternet: false, instance })` under `scheduling_policy: "durable_object"`. Its image is `image/build.ts` turned into a Dockerfile, deployed by the same `wrangler deploy`.
  - Gone: E2B, `E2B_API_KEY`, the E2B team's 20 running boxes and the template build in `deploy`.
  - Gone too: `max_instances` (that policy refuses it) and with it the `busy` failure and the 18 plus 2 split.
  - Gone: application-wide rollouts. A running box keeps its image until our code restarts it.
  - A global cap on running builds becomes ours to keep ([#34](https://github.com/chengchao/hopon/issues/34)). The account allows 1,500 concurrent vCPU by default, which is 750 boxes at 2 vCPU.
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

## Still open

- **Deployed numbers:** cold start with our 1.97 GB image, playtest time at 2 vCPU, real CPU per job from Workers traces, `snapshotContainer` timings, and the startup limit as Cloudflare measures it. The spike's `wrangler.jsonc` deploys as `hopon-coder-spike` with only `CLOUDFLARE_API_KEY` as a secret, and nothing else changes. It needs the owner's go-ahead.
- **Image size:** `node:24` full, as E2B's `fromNodeImage("24")` was. A slim base with Playwright's dependencies would shrink it.
- **Memory:** the 128 MB per isolate is shared by every Coder in it. A job holds its transcript with base64 screenshots and up to 438 KB of `music.js`. Not measured.

## How to run it

```bash
pnpm -F maker build:runtime
```

```bash
cd spikes/coder-on-workerd && npm install --no-package-lock wrangler@4.152.0 && npm approve-scripts workerd esbuild && npm rebuild workerd esbuild
```

Then link pi-ai, pi-coding-agent and typebox into the spike's `node_modules`, because its `src/probe.ts` imports them by name: `ln -s` each from the pnpm store. Put `CLOUDFLARE_API_KEY` from the main checkout's `apps/maker/.env` in `.dev.vars`, and start Docker.

```bash
node_modules/.bin/wrangler dev --port 8798
```

```bash
CODER_URL=http://localhost:8798 pnpm -F worker smoke:coder
```

`?fake` on a job route runs pi against an in-memory box with no container. `POST /__coder/:id/selftest`, `/probe` and `/readpng` exercise the box adapter, every pi tool, and a PNG `read`.
