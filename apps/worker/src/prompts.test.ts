import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { MAKER_VALUES, renderPrompt, toolResults } from "./prompts.ts";

const MAKER = readFileSync(
  new URL("../prompts/maker.md", import.meta.url),
  "utf-8"
);

const CAPTION = readFileSync(
  new URL("../prompts/caption.md", import.meta.url),
  "utf-8"
);

const TOOL_RESULTS = readFileSync(
  new URL("../prompts/tool-results.md", import.meta.url),
  "utf-8"
);

test("maker.md renders with every placeholder filled", () => {
  const rendered = renderPrompt(MAKER, MAKER_VALUES);
  assert.doesNotMatch(rendered, /\{\{|\}\}/u);
  assert.ok(rendered.includes(`${MAKER_VALUES.MAX_STEPS} tool calls`));
});

test("caption.md renders with the Caption's limit", () => {
  const rendered = renderPrompt(CAPTION, { CAPTION_MAX: 180 });
  assert.doesNotMatch(rendered, /\{\{|\}\}/u);
  assert.ok(rendered.includes("never more than 180"));
});

// ADR 0009: the harness gives the agent facts and what to do, and the agent writes the reply in the Creator's
// language. No line in a prompt is a sentence for the Creator, and none asks them to cut their request down.
test("no prompt tells the agent to quote a line or to ask the Creator for something simpler", () => {
  for (const prompt of [renderPrompt(MAKER, MAKER_VALUES), TOOL_RESULTS]) {
    assert.doesNotMatch(prompt, /Tell the Creator: "|word for word/u);
    assert.doesNotMatch(
      prompt,
      /maybe simpler|more simply|couldn't make it work/u
    );
    assert.doesNotMatch(prompt, /deadline|\d+ s\b/u);
  }
});

test("tool-results.md has every tool result the Maker gives, each with the values it's given", () => {
  const toolResult = toolResults(TOOL_RESULTS);
  const GIVE_UP = toolResult("give-up");
  assert.match(
    toolResult("steps", { MAX_STEPS: 30, NEXT: GIVE_UP }),
    /^Over this message's 30-step limit\. Nothing from this message is published.* sending the request again starts it afresh/u
  );
  assert.match(
    toolResult("ceiling", {
      MINUTES: 20,
      NEXT: toolResult("last-build", { GIVE_UP }),
    }),
    /^Past this message's 20-minute ceiling\. One last `build` can run now.*If it isn't finished, call no tool.*\s+Nothing from this message is published/su
  );
  assert.match(
    toolResult("builds", {
      MAX_BUILDS: 4,
      NEXT: toolResult("kept", { N: 2 }),
    }),
    /^Over this message's 4-build limit\. Revision 2, which you published in this run, stays: the Creator has it\. .*sending that part again adds it/u
  );
  assert.match(
    toolResult("check-failed", { ERRORS: "- boom", SKIPPED: "" }),
    /^The harness check failed:\s+- boom\s+Fix these/u
  );
  assert.match(
    toolResult("published", { N: 3, SKIPPED: "" }),
    /^Published: the Creator now has Revision 3\. If you're done, reply .*nothing about how you made it/u
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
