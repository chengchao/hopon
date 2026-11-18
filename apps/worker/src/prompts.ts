// The Maker's prompts are Markdown (apps/worker/prompts/*.md); the numbers and lines the code owns are `{{name}}`
// placeholders, filled here. maker.ts imports the Markdown as text and renders it once, at load.
import { GAME_DESCRIPTION_MAX, GAME_TITLE_MAX } from "@hopon/schemas";

import { DEADLINE_MS, MAX_BUILDS, MAX_STEPS } from "../../maker/src/job.ts";

// What the Maker says word for word when a tool reports these. The app shows when the Allowance resets, in the
// Creator's time.
export const BUSY = "The Maker is busy. Try again in a minute.";
export const USED_UP =
  "You've used this week's hopon tokens. They come back when the week resets.";

export const MAKER_VALUES = {
  BUILDS: MAX_BUILDS,
  BUSY,
  DESCRIPTION_MAX: GAME_DESCRIPTION_MAX,
  MAX_STEPS,
  MINUTES: DEADLINE_MS / 60_000,
  TITLE_MAX: GAME_TITLE_MAX,
  USED_UP,
};

const PLACEHOLDER = /\{\{(?<name>\w+)\}\}/gu;

// A placeholder with no value, or a value no placeholder uses, throws: either means the prompt and the code disagree.
// Only the template's own braces are checked: a value is text from outside (a game's error), and is put in as it is.
export const renderPrompt = (
  template: string,
  values: Record<string, string | number>
) => {
  const malformed = /\{\{.*?\}\}/u.exec(template.replaceAll(PLACEHOLDER, ""));
  if (malformed) {
    throw new Error(`the prompt's ${malformed[0]} isn't a placeholder`);
  }
  const used = new Set<string>();
  const rendered = template.replaceAll(PLACEHOLDER, (match, name: string) => {
    if (!Object.hasOwn(values, name)) {
      throw new Error(`the prompt's ${match} has no value`);
    }
    used.add(name);
    return String(values[name]);
  });
  const unused = Object.keys(values).filter((name) => !used.has(name));
  if (unused.length > 0) {
    throw new Error(`the prompt never uses ${unused.join(", ")}`);
  }
  return rendered;
};

// tool-results.md's sections: what the Maker's tools say to the agent, by name.
const TOOL_RESULTS = [
  "used-up",
  "busy",
  "run-ended",
  "restarted",
  "steps",
  "builds",
  "deadline",
  "no-game",
  "not-ready",
  "check-failed",
  "skipped",
  "published",
] as const;
export type ToolResult = (typeof TOOL_RESULTS)[number];

// Its sections, each rendered by name. A section the code doesn't know, or one it names that's missing, throws at load.
export const toolResults = (markdown: string) => {
  const sections = new Map(
    markdown
      .split(/^## /mu)
      .slice(1)
      .map((part) => {
        const end = part.indexOf("\n");
        return [part.slice(0, end).trim(), part.slice(end + 1).trim()];
      })
  );
  const names = new Set<string>(TOOL_RESULTS);
  const unknown = [...sections.keys()].filter((name) => !names.has(name));
  const missing = TOOL_RESULTS.filter((name) => !sections.has(name));
  if (unknown.length > 0 || missing.length > 0) {
    throw new Error(
      `tool-results.md: unknown ${unknown.join(", ") || "none"}, missing ${missing.join(", ") || "none"}`
    );
  }
  return (name: ToolResult, values: Record<string, string | number> = {}) =>
    renderPrompt(sections.get(name) ?? "", values);
};
