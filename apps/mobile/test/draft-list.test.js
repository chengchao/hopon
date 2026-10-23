import assert from "node:assert/strict";
import { test } from "node:test";

import { ago } from "../lib/draft-list.ts";

const NOW = Date.parse("2026-10-23T12:00:00.000Z");

test("a Draft's time reads as how long ago it changed", () => {
  assert.equal(ago("2026-10-23T11:59:30.000Z", NOW), "just now");
  assert.equal(ago("2026-10-23T11:55:00.000Z", NOW), "5 min ago");
  assert.equal(ago("2026-10-23T10:00:00.000Z", NOW), "2 h ago");
  assert.equal(ago("2026-10-20T12:00:00.000Z", NOW), "3 d ago");
});
