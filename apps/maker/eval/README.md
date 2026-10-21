# The Maker's model eval

The suite #115 defines, kept here and run by hand on a model or framework upgrade (ADR 0003's revisit triggers). Never in CI: it costs money and needs the keys in `apps/maker/.env` (see `.env.example`).

- `specs.json`: the Coder's 30 frozen jobs (22 builds, 16 LittleJS and 6 plain DOM, 8 edits, 5 with music).
- `revisions/<base>/`: the edits' frozen starting Revisions (built once with Sonnet 5.5 by `freeze`, checked by the owner).
- `chats.json`: the Talker's 8 scripted chats, run against a stub Coder.
- `calibration.json`: the owner's blind scores, which the report compares with the judge's.
- `results/`: the committed report of each sweep.

```bash
pnpm -F maker template                                 # once, or after changing image/
pnpm -F maker eval freeze                              # the edits' starting Revisions, if missing
pnpm -F maker eval smoke                               # Kimi: 5 jobs, images in tool results, median ≤ 120 s
pnpm -F maker eval coder --models a,b [--runs 3] [--jobs id,id] [--concurrency 6] [--sweep name]
pnpm -F maker eval talker --models a,b [--runs 3] [--chats id,id]
pnpm -F maker eval e2e [--talker id] [--talker-thinking high] [--coder id] [--thinking low]  # real Talker → real Coder
pnpm -F maker eval blind                               # 20 runs for the owner to score, without model names
pnpm -F maker eval calibrate < scores.json             # the blind page's scores into calibration.json
pnpm -F maker eval report                              # report.md, report.json, contact-sheet.png in out/<sweep>/
```

A sweep resumes: runs with a `result.json` under `out/<sweep>/` are skipped. Models: `claude-haiku-5-5`, `claude-sonnet-5-5`, `kimi-k3` (DeepSeek dropped by the owner), all at reasoning "low".

**A Coder run passes** when its last playtest is green, the eval's own playtests of the final game are green (the Coder's last inputs replayed, then a fixed 10 s random script), music jobs render a 20–40 s loop, it stayed within the turn limits (12 steps and 120 s, 150 s with music, since #116; the first sweeps ran at 12 steps and 4½ minutes), and the judge (Opus 5.5) scores ≥ 4 on "reads as the spec" and "playable" (and "did what was asked" for edits). **A Talker chat passes** when every turn scores ≥ 4 on "understood" and, with a build, "spec", every reply is ≤ 60 words with no code, and the chat's builds match the script (the off-limits request declined, the vague one built, the steer carried into the next build).

**A model wins** an agent when ≥ 90% of its runs pass, it meets the latency limits (Coder median ≤ 60 s and p90 ≤ 120 s, music jobs less 30 s; Talker first token ≤ 3 s and reply ≤ 10 s, medians (loosened from #115's 2 s and 8 s by the owner)), and its median $ per turn is the lowest among those that do. The turn limits come from the Coder winner's p95, never above 12 steps and 5 minutes.

## The pick (#116, 2026-10-20)

Claude Haiku 5.5 for both agents: the Talker at high effort, writing a design spec of up to ~300 words, and the Coder at low effort. Numbers, the runs behind them and what didn't work: [`results/2026-10-20.md`](results/2026-10-20.md).
