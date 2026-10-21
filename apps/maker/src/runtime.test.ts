import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { compileRuntime, SERVED_PATH } from "./runtime.ts";

test("the Worker serves the runtime the box builds", async () => {
  assert.equal(
    JSON.parse(readFileSync(SERVED_PATH, "utf-8")),
    await compileRuntime(),
    "apps/api/src/runtime/v1.json is stale: run `pnpm -F maker build:runtime`"
  );
});
