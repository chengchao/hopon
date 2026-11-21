import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_BUILDS, MAX_STEPS, RUN_CEILING_MS } from "../../maker/src/job.ts";
import { checkLimits } from "./limits.ts";
import type { RunCounts } from "./limits.ts";

const START = 1_000_000;
const fresh: RunCounts = { builds: 0, startedAt: START, steps: 0 };
const minutes = (n: number) => START + n * 60_000;

test("time alone refuses nothing short of the ceiling: a build 6 minutes in runs", () => {
  const { next, refused } = checkLimits(
    { ...fresh, steps: 12 },
    true,
    minutes(6)
  );
  assert.equal(refused, undefined);
  assert.equal(next.builds, 1);
  assert.equal(next.steps, 12);
});

test("past the ceiling with nothing published, one build runs, then nothing does", () => {
  const late = START + RUN_CEILING_MS + 1;
  const write = checkLimits({ ...fresh, steps: 9 }, false, late);
  assert.deepEqual(write.refused, { after: "last-build", limit: "ceiling" });

  const build = checkLimits(write.next, true, late);
  assert.equal(build.refused, undefined);
  assert.equal(build.next.finalBuild, true);

  // The build's check failed: no second try.
  const again = checkLimits(build.next, true, late);
  assert.deepEqual(again.refused, { after: "give-up", limit: "ceiling" });
});

test("past the ceiling after a publish, the agent replies about the game it published", () => {
  const { refused } = checkLimits(
    { ...fresh, builds: 1, published: 3 },
    true,
    START + RUN_CEILING_MS + 1
  );
  assert.deepEqual(refused, { after: "kept", limit: "ceiling" });
});

test("past the step limit, a finished game still gets its one build", () => {
  const over = checkLimits({ ...fresh, steps: MAX_STEPS }, false, minutes(1));
  assert.deepEqual(over.refused, { after: "last-build", limit: "steps" });
  const build = checkLimits(over.next, true, minutes(1));
  assert.equal(build.refused, undefined);
});

test("the build limit allows no last build", () => {
  const { refused } = checkLimits(
    { ...fresh, builds: MAX_BUILDS },
    true,
    minutes(1)
  );
  assert.deepEqual(refused, { after: "give-up", limit: "builds" });
});

test("a read of the skill is no step", () => {
  const state: RunCounts = { builds: 0, startedAt: 0, steps: MAX_STEPS };
  const read = checkLimits(state, false, 0, true);
  assert.equal(read.refused, undefined);
  assert.equal(read.next.steps, MAX_STEPS);
  assert.equal(checkLimits(state, false, 0).refused?.limit, "steps");
});
