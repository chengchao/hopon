# Paused E2B sandboxes: cost, limits, and warming Chromium into the template

Research for [#113](https://github.com/chengchao/hopon/issues/113), part of the Maker map [#111](https://github.com/chengchao/hopon/issues/111). Researched 2026-10-16 against E2B's own docs and pricing page only; no sandboxes were run.

**Question:** Spike A measured E2B create 0.5 s, pause 0.3 s, resume 0.5 s, but the first playtest in a fresh box takes 22 s because Chromium cold-starts. What do paused sandboxes cost, and what are their limits? Can a template start command launch Chromium once before the snapshot so a fresh box is already warm? Which Hobby vs Pro limits matter for ~20 concurrent Drafts? Pause between turns, or restore from R2 each turn?

**Short answer:** Paused sandboxes are **free and kept forever**: "Paused and killed sandboxes are not billed", retention is "Unlimited" on every plan, and they do not count toward the concurrency limit. There is **no documented storage cap** on paused sandboxes beyond the per-sandbox disk size (10 GiB Hobby, 20 GiB Pro). **Yes, the template start command runs at build time and its process is captured in the snapshot**: a sandbox created from the template starts with Chromium already running, "there is no startup wait". **Hobby allows 20 concurrent running sandboxes and 1 sandbox creation per second**, so ~20 concurrent Drafts sits exactly at Hobby's ceiling; Pro ($150/mo) gives 100 and 5/s. **Recommendation: pause between turns, and also warm Chromium in the template.** The two are complementary: the template fix removes the 22 s for every fresh box, pause makes a Draft's box free while the person types and resumes in ~1 s with the project and the browser still in memory.

## 1. Paused sandbox price and limits

| Fact | Value | Source |
| --- | --- | --- |
| Price while paused | Not billed. "Paused and killed sandboxes are not billed." Billing "stops immediately" on pause. | [calculate-sandbox-price](https://docs.e2b.dev/faq/calculate-sandbox-price), [billing](https://docs.e2b.dev/billing) |
| Storage price | "Storage: Free"; disk included at 10 GiB (Hobby) / 20 GiB (Pro). No separate snapshot or persistence price anywhere on the pricing or billing pages. | [pricing](https://e2b.dev/pricing), [billing](https://docs.e2b.dev/billing) |
| Max age | None. "A paused sandbox is kept indefinitely", "no time-to-live and no automatic deletion"; removed only by an explicit `kill`. Retention "Unlimited" on all plans. | [persistence](https://docs.e2b.dev/sandbox/persistence), [limits](https://docs.e2b.dev/sandbox/limits) |
| Max count | **Undocumented.** Paused sandboxes do "not count toward your concurrency limit", and no page states a cap on how many may exist. Assume none, but it is not promised. | [paused-sandboxes-concurrency](https://docs.e2b.dev/faq/paused-sandboxes-concurrency) |
| What is saved | Default: filesystem and memory, "which includes running processes and loaded variables". `mode: 'filesystem'` saves only disk and reboots on resume. Network services are unreachable while paused; clients reconnect after resume. | [persistence](https://docs.e2b.dev/sandbox/persistence) |
| Pause / resume time | Docs: "approximately 4 seconds per 1 GiB of RAM" to pause, "approximately 1 second" to resume. Spike A measured 0.3 s / 0.5 s, so the docs are conservative. | [persistence](https://docs.e2b.dev/sandbox/persistence) |
| Auto-pause | `Sandbox.create({ lifecycle: { onTimeout: 'pause' } })`; default is `'kill'`. Default timeout 5 min. Auto-pause persists across resumes. `Sandbox.connect(id)` resumes a paused sandbox automatically. | [persistence](https://docs.e2b.dev/sandbox/persistence) |
| Pause refusal | A pause can return HTTP 503 while the node finishes a previous snapshot (`ServiceBusyError`, SDK >= 2.48.0); the sandbox keeps running, retry. Rolling out region by region. | [persistence](https://docs.e2b.dev/sandbox/persistence) |
| Running-time cap | "Max continuous runtime (without pause)": 1 h Hobby, 24 h Pro. "Pausing and resuming resets it." | [sandbox-lifetime](https://docs.e2b.dev/faq/sandbox-lifetime), [limits](https://docs.e2b.dev/sandbox/limits) |

Running cost for reference: vCPU $0.000014/s, RAM $0.0000045/GiB-s, so a 2 vCPU / 4 GiB box is about $0.17/h and a 2 vCPU / 1 GiB box about $0.12/h ([pricing](https://e2b.dev/pricing)). A 5-minute turn on the larger box is ~1.4 cents.

## 2. Can the template start command warm Chromium?

Yes, by design. From [template/start-cmd](https://docs.e2b.dev/template/start-cmd):

- "The start command specifies a process that runs at the end of the template build — not when a sandbox is created."
- Build order: run the start command, loop the ready command "until it returns a successful exit code 0", then take "a snapshot of the entire sandbox including the running process".
- Result: "the snapshotted process is already running" and "there is no startup wait".
- Template SDK: `setStartCmd(startCmd, readyCmd)`; ready helpers `waitForPort`, `waitForURL` (default 200), `waitForProcess`, `waitForFile`, `waitForTimeout`. `setReadyCmd` alone if a `runCmd` step already started the process.
- Env vars passed to `Sandbox.create()` are not visible to the start command; use `setEnvs()` in the template.

So the shape is: `setStartCmd('chromium-headless-shell --headless --remote-debugging-port=9222 ...', waitForPort(9222))`, and the playtest connects to the already-listening DevTools port instead of spawning Chromium. This is the same mechanism E2B documents for any long-lived server.

**Undocumented:** whether a Chromium process in particular survives the snapshot/restore cleanly (GPU-less rendering, clock jumps, open sockets). Nothing in the docs says it does not; the persistence page explicitly says running processes survive the memory snapshot. This needs one measured run in spike A's template before the spec relies on it, which is a cheap follow-up (one template build and one `Sandbox.create`).

## 3. Hobby vs Pro limits that matter for ~20 concurrent Drafts

| Limit | Hobby | Pro | Why it matters |
| --- | --- | --- | --- |
| Base price | $0 (+ $100 one-time credits) | $150/mo + usage |  |
| Concurrent **running** sandboxes | 20 | 100 (add-ons: +500 for $500/mo, up to 1,100) | 20 Drafts mid-turn is the whole Hobby budget; the 21st turn fails to create or resume. |
| Sandbox creation rate | 1/s | 5/s | A burst of turns queues behind creates; whether resumes are subject to the same gate is undocumented. |
| Max continuous runtime | 1 h | 24 h | Irrelevant if we pause between turns (resets the clock); a 5-min turn never hits it. |
| Max vCPU / RAM | 8 / 8 GiB | 8+ / 8+ GiB | Ample; a Draft box needs ~2 vCPU / 1–4 GiB. |
| Disk | 10 GiB | 20+ GiB | Ample. |
| Paused retention | Unlimited | Unlimited |  |
| API rate limit (list/get) | 10/s | 20/s | Fine. |
| Concurrent template builds | 20 | 20 | Fine. |

Sources: [limits](https://docs.e2b.dev/sandbox/limits), [billing](https://docs.e2b.dev/billing), [pricing](https://e2b.dev/pricing).

Because paused boxes are free and uncounted, the concurrency limit is about **turns in flight**, not Drafts that exist. With today's 10 generations/day per account, 20 simultaneous turns is a launch-scale ceiling, not a day-one one. Start on Hobby; move to Pro when turns in flight approach 15 or when the 1/s create rate shows up in the eval.

## 4. Pause between turns vs restore from R2 each turn

|  | Pause between turns | Restore from R2 each turn |
| --- | --- | --- |
| Idle cost | $0 (documented) | $0 sandbox; R2 storage $0.015/GB-mo, Class A $4.50/M, Class B $0.36/M, free egress ([R2 pricing](https://developers.cloudflare.com/r2/pricing/)), negligible for KB-scale projects |
| Turn start latency | ~1 s resume (0.5 s measured), Chromium still warm in memory | 0.5 s create + fetch files + Chromium start (22 s cold today, ~0 with a warmed template) |
| State fidelity | Exact: filesystem, memory, processes | Only what we chose to upload; any `node_modules` or build cache must be re-derived or stored |
| Failure modes | Pause 503 (retry); durability of a paused box beyond "kept indefinitely" is not promised | R2 is the durable store anyway |
| Housekeeping | We must `kill` abandoned boxes ourselves or they accumulate forever (no TTL). Fits "snapshot pruning and Draft lifetime" in #111's open list | Nothing to prune on E2B |
| Vendor coupling | Draft state lives in E2B until we export it | Draft state lives in R2; boxes are disposable |

**Recommendation: pause between turns, with R2 as the durable copy and the warmed template as the fallback path.**

- Each turn: `Sandbox.connect(draft.sandboxId)` (auto-resumes), run the turn, write the Revision's `game.ts`/`game.js` to R2 as today, then `pause()`. Create with `lifecycle.onTimeout: 'pause'` so a crash mid-turn pauses rather than kills.
- If the box is missing (killed by our pruner, or lost), create a fresh one from the warmed template and restore the Revision's files from R2. That is the "restore from R2" strategy as a code path we need anyway.
- Prune: kill paused boxes for Drafts idle past the Draft lifetime (#111 open item). This is the one obligation pause adds: nothing expires on E2B's side.
- Warm Chromium in the template regardless: it is the only thing that fixes the 22 s for the first turn of a new Draft, and it makes the R2 fallback as fast as a resume.

Decisive facts: paused = $0 and no TTL (so the only cost of pausing is our own pruning), resume ~1 s with memory intact (so a turn never re-pays Chromium startup), and the template start command is snapshotted with its process running (so a fresh box need not either).

## Open items

- Measure that a snapshotted Chromium actually answers on its DevTools port in a fresh sandbox (one build, one create). Undocumented, see §2.
- Whether resume counts against the 1/s (Hobby) creation rate. Undocumented.
- Any cap on the number of paused sandboxes per account. Undocumented; assume none.
