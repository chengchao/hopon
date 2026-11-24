import assert from "node:assert/strict";
import { test } from "node:test";

import { dropCaption, keepCaption, keptCaption } from "../lib/draft-caption.ts";

test("a Draft's Caption is kept, the Creator's last edit winning, and no other Draft's", () => {
  assert.equal(keptCaption("a"), undefined);
  keepCaption("a", "bet you can't last 30 seconds");
  keepCaption("a", "beat my score");
  assert.equal(keptCaption("a"), "beat my score");
  assert.equal(keptCaption("b"), undefined);
});

test("a Caption the Creator emptied is kept as empty, not as none", () => {
  keepCaption("b", "");
  assert.equal(keptCaption("b"), "");
});

test("a dropped Caption is gone", () => {
  keepCaption("a", "beat my score");
  dropCaption("a");
  assert.equal(keptCaption("a"), undefined);
});
