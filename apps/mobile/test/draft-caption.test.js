import assert from "node:assert/strict";
import { test } from "node:test";

import { dropCaption, keepCaption, keptCaption } from "../lib/draft-caption.ts";

const first = { id: "a", updatedAt: "2026-11-23T08:00:00.000Z" };
const rebuilt = { id: "a", updatedAt: "2026-11-23T08:05:00.000Z" };
const other = { id: "b", updatedAt: first.updatedAt };

test("a Draft's Caption is kept for its Revision, the Creator's last edit winning", () => {
  assert.equal(keptCaption(first), undefined);
  keepCaption(first, "bet you can't last 30 seconds");
  keepCaption(first, "beat my score");
  assert.equal(keptCaption(first), "beat my score");
  assert.equal(keptCaption(other), undefined);
});

test("a Caption the Creator emptied is kept as empty, not as none", () => {
  keepCaption(other, "");
  assert.equal(keptCaption(other), "");
});

test("a new Revision starts without a Caption, and so does a Draft whose Caption was dropped", () => {
  keepCaption(first, "beat my score");
  assert.equal(keptCaption(rebuilt), undefined);
  keepCaption(rebuilt, "new and harder");
  assert.equal(keptCaption(first), undefined);
  dropCaption("a");
  assert.equal(keptCaption(rebuilt), undefined);
});
