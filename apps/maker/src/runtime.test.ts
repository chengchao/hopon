import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { assertUnchanged, compileRuntime, SERVED_PATH } from "./runtime.ts";

test("the Worker serves the runtime the box builds", async () => {
  const served = JSON.parse(readFileSync(SERVED_PATH, "utf-8"));
  assertUnchanged(served);
  assert.equal(
    served,
    await compileRuntime(),
    "apps/worker/src/runtime/v2.json is stale: run `pnpm -F maker build:runtime`, which says so if v2 is frozen"
  );
});

test("a frozen runtime refuses different bytes", () => {
  const frozen = createHash("sha256").update("v1").digest("hex");
  assert.doesNotThrow(() => assertUnchanged("v1", frozen));
  assert.throws(() => assertUnchanged("v1 changed", frozen), /frozen/u);
});
