// pnpm -F maker spike:box [--cycles 20] [--local-only]
// Playtests the littlejs-api skill's examples in a LocalBox, then in E2B: one playtest, egress and env checks,
// and create / pause / resume latency over N cycles.
/* oxlint-disable no-await-in-loop -- measurements run one at a time */
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { E2BBox, LocalBox } from "./box.ts";
import type { Box } from "./box.ts";
import { SKILLS_DIR } from "./maker.ts";

const { values } = parseArgs({
  options: {
    cycles: { default: "20", type: "string" },
    "local-only": { type: "boolean" },
  },
});

const examples = [
  ...readFileSync(path.join(SKILLS_DIR, "littlejs-api.md"), "utf-8")
    .split("## Examples")[1]
    .matchAll(/```ts\n(?<code>[\s\S]*?)```/gu),
].map((match) => match.groups?.code ?? "");

const timed = async <T>(work: () => Promise<T>) => {
  const started = performance.now();
  const value = await work();
  return { ms: Math.round(performance.now() - started), value };
};

const playtest = async (box: Box, game: string) => {
  await box.writeFile("game.ts", game);
  const { ms, value } = await timed(() => box.run("await playtest();"));
  const line = value.stdout.split("\n").find((text) => text.startsWith("{"));
  return {
    exitCode: value.exitCode,
    ms,
    result: line ? JSON.parse(line) : value.stderr.slice(0, 500),
  };
};

const stats = (samples: number[]) => {
  const sorted = [...samples].toSorted((a, b) => a - b);
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { max: sorted.at(-1), min: sorted[0], p50: at(0.5), p90: at(0.9) };
};

const local = await LocalBox.create();
for (const game of examples) {
  console.log("local", await playtest(local, game));
}

if (!values["local-only"]) {
  const created = await timed(() => E2BBox.create());
  const box = created.value;
  console.log("e2b create", created.ms, "ms", box.sandbox.sandboxId);
  console.log("e2b playtest (cold)", await playtest(box, examples[0]));
  console.log("e2b playtest (warm)", await playtest(box, examples[0]));
  const probe = await box.run(`
    try { await fetch("https://example.com", { signal: AbortSignal.timeout(5000) }); console.log("egress: OPEN"); }
    catch (error) { console.log("egress: blocked (" + (error.cause?.code ?? error.message) + ")"); }
    console.log("env:", Object.keys(process.env).sort().join(" "));
  `);
  console.log(probe.stdout, probe.stderr);
  await box.sandbox.kill();

  const create: number[] = [];
  const pause: number[] = [];
  const resume: number[] = [];
  const warm: number[] = [];
  const again: number[] = [];
  for (let cycle = 0; cycle < Number(values.cycles); cycle += 1) {
    const made = await timed(() => E2BBox.create());
    create.push(made.ms);
    await made.value.writeFile("note.txt", `cycle ${cycle}`);
    const before = await timed(() => made.value.run("console.log(1)"));
    warm.push(before.ms);
    const paused = await timed(() => made.value.sandbox.pause());
    pause.push(paused.ms);
    const back = await timed(() => E2BBox.resume(made.value.sandbox.sandboxId));
    // The first command after resume is part of the cost of coming back.
    const first = await timed(() =>
      back.value.run(`console.log(read("note.txt"))`)
    );
    resume.push(back.ms + first.ms);
    const second = await timed(() => back.value.run("console.log(1)"));
    again.push(second.ms);
    if (!first.value.stdout.includes(`cycle ${cycle}`)) {
      console.log("resume lost the workspace", first.value);
    }
    await back.value.sandbox.kill();
    console.log(
      `cycle ${cycle}: create ${made.ms} pause ${pause.at(-1)} resume+run ${resume.at(-1)} (run ${first.ms}, warm run before pause ${before.ms}, second run after ${second.ms})`
    );
  }
  console.log(
    JSON.stringify({
      create: stats(create),
      pause: stats(pause),
      resumeAndRun: stats(resume),
      runAfterResume: stats(again),
      warmRun: stats(warm),
    })
  );
}
