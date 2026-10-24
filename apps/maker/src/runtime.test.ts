import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  assertUnchanged,
  compileRuntime,
  DOM_SERVED_PATH,
  DOM_V1_SHA256,
  domScaffold,
  SERVED_PATH,
  V2_SHA256,
} from "./runtime.ts";

const STALE =
  "is stale: run `pnpm -F maker build:runtime`, which says so if it's frozen";

test("the Worker serves the runtime the box builds", async () => {
  const served = JSON.parse(readFileSync(SERVED_PATH, "utf-8"));
  assertUnchanged(served, V2_SHA256, "/runtime/v2.js");
  assert.equal(served, await compileRuntime(), `${SERVED_PATH} ${STALE}`);
});

test("the Worker serves the plain-DOM scaffold the box serves", () => {
  const served = JSON.parse(readFileSync(DOM_SERVED_PATH, "utf-8"));
  assertUnchanged(served, DOM_V1_SHA256, "/dom/v1.js");
  assert.equal(served, domScaffold(), `${DOM_SERVED_PATH} ${STALE}`);
});

test("a frozen runtime refuses different bytes", () => {
  const frozen = createHash("sha256").update("v1").digest("hex");
  assert.doesNotThrow(() => assertUnchanged("v1", frozen, "/runtime/v1.js"));
  assert.throws(
    () => assertUnchanged("v1 changed", frozen, "/runtime/v1.js"),
    /frozen/u
  );
});
