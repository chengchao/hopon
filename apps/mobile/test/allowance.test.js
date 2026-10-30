import assert from "node:assert/strict";
import { test } from "node:test";

import { allowanceLine, low, usedUp } from "../lib/allowance.ts";

// Monday 00:00 UTC is 8:00 AM in Shanghai.
process.env.TZ = "Asia/Shanghai";
const week = (left) => ({
  left,
  resetsAt: "2026-11-02T00:00:00.000Z",
  weekly: 3_000_000,
});

test("one line: what's left, rounded down, and the reset in the Creator's time", () => {
  assert.equal(
    allowanceLine(week(1_234_567)),
    "1.2M hopon tokens left · resets Mon 8:00 AM"
  );
  assert.equal(
    allowanceLine(week(3_000_000)),
    "3M hopon tokens left · resets Mon 8:00 AM"
  );
  assert.equal(
    allowanceLine(week(599_999)),
    "599.9K hopon tokens left · resets Mon 8:00 AM"
  );
  // The last turn may overshoot; the line doesn't go below zero.
  assert.equal(
    allowanceLine(week(-500)),
    "0 hopon tokens left · resets Mon 8:00 AM"
  );
  assert.equal(
    usedUp(week(-500)),
    "You've used this week's hopon tokens. They reset Mon 8:00 AM."
  );
});

test("low below 20% of the week's Allowance", () => {
  assert.equal(low(week(600_000)), false);
  assert.equal(low(week(599_999)), true);
  assert.equal(low(week(-1)), true);
});
