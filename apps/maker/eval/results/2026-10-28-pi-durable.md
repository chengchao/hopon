# The pi-durable Coder's gate, 2026-10-28

#179: ADR 0003's gate for switching the Coder to pi-durable, a Durable Object running PiHarness with a Container box. It is #116's e2e, run on PR #190's Worker Preview, with the real Talker driving the Coder through the Draft API.

**Result: passes the re-based bar, the owner's ruling.** The judge passed 88% of the games it scored. The median build took 85 s and the p95 123 s, no slower than the old Coder measured the same day (89 s and 128 s). #116's 62 s / 120 s no longer holds for either Coder, because Haiku 5.5 now thinks several times longer on the Talker's specs.

## Setup

- The Preview `claude-pi-durable-coder-66ae99` at 61d8e1362: agents 0.30.1, pi-durable 1.4.0, pi-ai 1.4.0.
- Coder: `claude-haiku-5-5` at effort low. Talker: the same model at effort high.
- The judge: Opus 5.5 at effort high, through headless Claude Code on the owner's subscription. The gateway's Unified Billing answered 402 with two calls in flight.
- The 8 scripted chats × 6, 3 at a time, in 8 batches of ≤ 10 builds, with the eval user's daily count cleared between batches.
- The Talker made 67 of the 72 scripted builds. 58 were judged; the other 9 ran past the deadline.
- Run 2026-10-28 23:22 → 10-29 00:26 UTC. Sweep `out/pi-durable-179-gate`, not committed.

## Numbers

|  | pi-durable | Bar | #116 (10-20) |
| --- | --- | --- | --- |
| Judge pass: spec and playable ≥ 4 (and edit for edits), of the judged builds | **51 / 58 = 88%** | ≥ 85% | 89% |
| Builds that pass every check (updated rule, below) | 51 / 67 = 76% |  |  |
| Median s, music less 30 s | **85** | ≤ 89 | 62 |
| p95 s | **123** | ≤ 128 | 112 |
| Median / p95 steps | 4 / 9 | ≤ 12 |  |
| Coder $ per build (gateway, by job) | median $0.012, mean $0.011 |  | $0.0086 |
| Looks (1–5, reported only) | 3.02 |  | 3.08 (10-21) |

- Judge pass by kind: new games 35 / 39, edits 16 / 19.
- The 67 Coder jobs cost $0.74 in all.
- The Talker cost $0.056, with a median first token of 4.9 s and a median reply of 9.1 s. Its chats pass 69%, but the subscription judge is kinder on "understood", so that number isn't comparable with earlier runs.

**Failures** (16 of 67 under the updated rule):

| Reason | Builds | Note |
| --- | --- | --- |
| Past the Coder's 120 s deadline | 9 | 6 of these are `change-after-build`, both builds |
| The judge scored spec or playable below 4 | 7 | Set up for the owner's blind score |

**Same-day baseline, timing only** (10-28, 8 chats × 1, one at a time, judge off):

| Coder                             | Median | p95   |
| --------------------------------- | ------ | ----- |
| pi-durable                        | 75 s   | 123 s |
| The old Container Coder on `main` | 89 s   | 128 s |

## Why builds are slower than #116

The game-writing call thinks 7–24k tokens on the Talker's ~2,000-character specs, against ~1k on #116's frozen ~300-character specs. pi-coding-agent does the same on the same spec today: the request is identical, effort is honoured, and throughput is unchanged. Details are in #179.

## The eval, updated

- **The judge** runs through `claude -p` on the developer's subscription (`eval/judge.ts`). Re-judging 5 gateway-judged games gave the same pass or fail on all 5.
- **No no-input replay in e2e.** The Preview doesn't report the Coder's last inputs, so the replay played 3 s with none, and a game that waits for a tap looked frozen. 10 of 67 builds failed only that, and every one was green on the random playtest. The e2e's final check is now the random script alone, so the gate run's 63% under the old rule is 76% under the new one.

## Open

- The owner blind-scores the 7 judge failures (`out/pi-durable-179-gate/blind/index.html`).
- The thinking could be cut, by a shorter spec for the Coder or no thinking on the game-writing call. That would speed up both Coders and is a change of its own.
