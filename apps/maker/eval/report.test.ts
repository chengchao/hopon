import assert from "node:assert/strict";
import { test } from "node:test";

import type { CoderRecord } from "./coder.ts";
import { coderStats, quantile, talkerStats } from "./report.ts";
import type { TalkerRecord } from "./talker.ts";

const chat = (pass: boolean, replyMs: number) =>
  ({
    chat: "big-voyage",
    cost: 1.2,
    limitOk: pass,
    pass,
    turns: [{ cost: 0.05, firstTokenMs: 900, replyMs }],
  }) as unknown as TalkerRecord;

test("the e2e summary's talker stats compute over big-voyage runs, one failed on limit talk", () => {
  const stats = talkerStats([chat(true, 4000), chat(false, 6000)]);
  assert.equal(stats.passRate, 0.5);
  assert.equal(stats.turns, 2);
  assert.equal(stats.medianReplyS, 4);
  assert.equal(stats.totalCost, 2.4);
});

test("quantile is nearest rank", () => {
  const values = Array.from({ length: 90 }, (_, index) => index + 1);
  assert.equal(quantile(values, 0.5), 45);
  assert.equal(quantile(values, 0.95), 86);
  assert.ok(Number.isNaN(quantile([], 0.5)));
});

const run = (seconds: number, music = false, pass = true) =>
  ({
    cost: 0.01,
    firstGreen: true,
    music,
    pass,
    playtests: 2,
    seconds,
    steps: 4,
    warnings: [],
  }) as unknown as CoderRecord;

test("a model clears on pass rate and latency, music jobs less 30 s", () => {
  const fast = Array.from({ length: 10 }, () => run(50));
  assert.equal(coderStats(fast).clears, true);
  assert.equal(
    coderStats([...fast.slice(1), run(50, false, false)]).clears,
    true
  );
  assert.equal(
    coderStats([...fast.slice(2), run(50, false, false), run(50, false, false)])
      .clears,
    false
  );
  assert.equal(
    coderStats(Array.from({ length: 10 }, () => run(85, true))).clears,
    true
  );
  assert.equal(
    coderStats(Array.from({ length: 10 }, () => run(85))).clears,
    false
  );
});

const refused = (reason: string) =>
  ({
    ...(run(50, false, false) as unknown as object),
    reason,
  }) as unknown as CoderRecord;

test("failed builds are split by the limit their refusal names, old sweeps' deadline included", () => {
  const { failures } = coderStats([
    refused(
      "Tool call blocked: Past this message's 20-minute ceiling. One last `build` can run now"
    ),
    refused(
      "Tool call blocked: Over this message's 30-step limit. Nothing from this message is published"
    ),
    refused(
      "Tool call blocked: Over this message's 4-build limit. Revision 2, which you published in this run, stays"
    ),
    refused(
      "Tool call blocked: Past the 300 s deadline. Tell the Creator you couldn't make it work this time."
    ),
    refused("The Maker is busy: its sandbox couldn't start."),
    refused("The harness check failed: boom"),
  ]);
  assert.deepEqual(failures, {
    builds: 1,
    busy: 1,
    ceiling: 1,
    "coder failed": 1,
    deadline: 1,
    steps: 1,
  });
});

test("what a Preview doesn't report is left out, not counted as 0", () => {
  const preview = {
    ...(run(50) as unknown as object),
    cost: null,
    firstGreen: null,
  } as unknown as CoderRecord;
  const stats = coderStats([run(50), preview]);
  assert.equal(stats.firstGreen, 1);
  assert.equal(stats.medianCost, 0.01);
  assert.equal(stats.totalCost, 0.01);
  assert.ok(Number.isNaN(coderStats([preview]).totalCost));
});
