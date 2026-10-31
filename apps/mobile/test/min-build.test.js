import assert from "node:assert/strict";
import { test } from "node:test";

import { updateRequired } from "../lib/min-build.ts";

test("update required only below the minimum build, compared as numbers", () => {
  assert.equal(updateRequired("10", 11), true);
  assert.equal(updateRequired("11", 11), false);
  assert.equal(updateRequired("100", 11), false);
  // No build number to compare: let the app run.
  assert.equal(updateRequired(null, 11), false);
  assert.equal(updateRequired(undefined, 11), false);
  assert.equal(updateRequired("", 11), false);
  assert.equal(updateRequired("dev", 11), false);
});
