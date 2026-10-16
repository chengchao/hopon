// pnpm -F maker eval [--box local|e2b] [--models a,b] — the five spike prompts on each model, then a table.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { runOnce } from "./chat.ts";
import { MODELS } from "./maker.ts";

export const PROMPTS = [
  // The three examples in apps/mobile/app/create.tsx.
  "A cat jumping on the moon. Tap to dodge meteors and collect stars.",
  "A pixel-art fruit catcher. Move a basket to catch apples and avoid bombs.",
  "An ocean animal memory game. Flip cards and find every matching pair to win.",
  "A neon snake game. Swipe to turn, eat the glowing dots, don't bite your own tail.",
  "Whack-a-mole with garden gnomes: tap them before they duck back down. 30 seconds on the clock.",
];

const { values } = parseArgs({
  options: {
    box: { default: "local", type: "string" },
    models: { default: Object.keys(MODELS).join(","), type: "string" },
  },
});

const boxKind = values.box === "e2b" ? "e2b" : "local";
// One worker per model; prompts run in order within it.
const perModel = await Promise.all(
  values.models.split(",").map(async (modelId) => {
    const rows = [];
    for (const prompt of PROMPTS) {
      // oxlint-disable-next-line no-await-in-loop -- one run at a time per model
      const row = await runOnce({
        boxKind,
        modelId,
        prompt,
        quiet: true,
      }).catch((error: unknown) => ({
        error: String(error),
        model: modelId,
        prompt,
      }));
      console.log(JSON.stringify(row));
      rows.push(row);
    }
    return rows;
  })
);
const results = perModel.flat();

writeFileSync(
  path.join(import.meta.dirname, "..", "out", `eval-${Date.now()}.json`),
  JSON.stringify(results, null, 2)
);
console.log(
  "| model | prompt | first playtest ok | final ok | run_node calls | in / out tokens | $ | images | s |"
);
console.log("|---|---|---|---|---|---|---|---|---|");
for (const row of results) {
  if ("error" in row) {
    console.log(
      `| ${row.model} | ${row.prompt.slice(0, 28)} | error: ${row.error.slice(0, 60)} |||||||`
    );
    continue;
  }
  console.log(
    `| ${row.model} | ${row.prompt.slice(0, 28)}… | ${row.firstPlaytestOk ? "yes" : "no"} | ${row.lastPlaytestOk ? "yes" : "no"} | ${row.runs} | ${row.usage.input} / ${row.usage.output} | ${row.usage.cost.toFixed(3)} | ${row.imagesSent}${row.errors.length > 0 ? " ⚠" : ""} | ${row.seconds} |`
  );
}
