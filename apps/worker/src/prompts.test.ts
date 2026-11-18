import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { MAKER_VALUES, renderPrompt, toolResults } from "./prompts.ts";

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

test("tool-results.md has every tool result the Maker gives, each with the values it's given", () => {
  const toolResult = toolResults(
    readFileSync(
      new URL("../prompts/tool-results.md", import.meta.url),
      "utf-8"
    )
  );
  assert.match(
    toolResult("steps", { MAX_STEPS: 20 }),
    /^Over the 20-step limit\. Tell the Creator/u
  );
  assert.match(
    toolResult("check-failed", { ERRORS: "- boom", SKIPPED: "" }),
    /^The harness check failed:\s+- boom\s+Fix these/u
  );
  assert.equal(
    toolResult("published", { N: 3, SKIPPED: "" }),
    "Published: the Creator now has Revision 3."
  );
  assert.throws(() => toolResult("published", { N: 3 }), /SKIPPED/u);
  assert.throws(
    () => toolResults("## steps\n\nOver.\n\n## nonsense\n\nHi."),
    /unknown nonsense/u
  );
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

test("braces in a value are the value's text, not a placeholder", () => {
  const toolResult = toolResults(
    readFileSync(
      new URL("../prompts/tool-results.md", import.meta.url),
      "utf-8"
    )
  );
  assert.equal(
    renderPrompt("Error: {{ERROR}}", { ERROR: "{{score}} is undefined" }),
    "Error: {{score}} is undefined"
  );
  assert.match(
    toolResult("check-failed", {
      ERRORS: "- tests.json: {{score}} is not a number",
      SKIPPED: "",
    }),
    /- tests\.json: \{\{score\}\} is not a number/u
  );
});

test("a value no placeholder uses throws", () => {
  assert.throws(
    () => renderPrompt("No numbers here.", { MAX_STEPS: 20 }),
    /never uses MAX_STEPS/u
  );
});
