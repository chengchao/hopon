import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { MAKER_VALUES, renderPrompt } from "./prompts.ts";

const MAKER = readFileSync(
  new URL("../prompts/maker.md", import.meta.url),
  "utf-8"
);

test("maker.md renders with every placeholder filled", () => {
  const rendered = renderPrompt(MAKER, MAKER_VALUES);
  assert.doesNotMatch(rendered, /\{\{|\}\}/u);
  assert.ok(rendered.includes(MAKER_VALUES.USED_UP));
  assert.ok(rendered.includes(`${MAKER_VALUES.MAX_STEPS} tool calls`));
});

test("an unfilled placeholder throws", () => {
  assert.throws(
    () => renderPrompt("Up to {{MAX_STEPS}} steps.", {}),
    /\{\{MAX_STEPS\}\} has no value/u
  );
  assert.throws(
    () => renderPrompt("Up to {{ MAX_STEPS }} steps.", { MAX_STEPS: 20 }),
    /isn't a placeholder/u
  );
});

test("a value no placeholder uses throws", () => {
  assert.throws(
    () => renderPrompt("No numbers here.", { MAX_STEPS: 20 }),
    /never uses MAX_STEPS/u
  );
});
