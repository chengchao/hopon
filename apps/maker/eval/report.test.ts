import assert from "node:assert/strict";
import { test } from "node:test";

import type { CoderRecord } from "./coder.ts";
import { coderStats, quantile } from "./report.ts";

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
