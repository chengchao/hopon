import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { assertV1Unchanged, compileRuntime, SERVED_PATH } from "./runtime.ts";

test("the Worker serves the runtime the box builds", async () => {
  const served = JSON.parse(readFileSync(SERVED_PATH, "utf-8"));
  assertV1Unchanged(served);
  assert.equal(
    served,
    await compileRuntime(),
    "apps/worker/src/runtime/v1.json is stale: run `pnpm -F maker build:runtime`, which says so if v1 is frozen"
  );
});

test("a frozen v1 refuses different bytes", () => {
  const frozen = createHash("sha256").update("v1").digest("hex");
  assert.doesNotThrow(() => assertV1Unchanged("v1", frozen));
  assert.throws(() => assertV1Unchanged("v1 changed", frozen), /frozen/u);
});
