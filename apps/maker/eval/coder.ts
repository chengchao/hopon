// The eval's Coder jobs and runs: the frozen jobs, the pass rule, and the record each run's result.json holds. The
// runs come from a Preview (preview.ts) since #178; older sweeps' in-process runs under out/ have the same shape.
import { readFileSync } from "node:fs";
import path from "node:path";

import { isLittlejsHtml, MUSIC } from "../image/page.ts";
import type { Spec } from "../src/job.ts";
import type { judgeCoder } from "./judge.ts";

const EVAL = import.meta.dirname;
export const OUT = path.join(EVAL, "..", "out");
const RUNTIME = path.join(EVAL, "..", "image", "runtime.js");
const DOM_RUNTIME = path.join(EVAL, "..", "image", "dom.js");
export const REVISIONS = path.join(EVAL, "revisions");

interface BuildSpec {
  id: string;
  engine: "littlejs" | "dom";
  spike?: boolean;
  spec: Spec;
}
interface EditSpec {
  id: string;
  base: string;
  spec: Spec;
}
export const SPECS = JSON.parse(
  readFileSync(path.join(EVAL, "specs.json"), "utf-8")
) as { builds: BuildSpec[]; edits: EditSpec[] };

export interface CoderJob {
  id: string;
  kind: "build" | "edit";
  base?: string;
  spec: Spec;
}
export const CODER_JOBS: CoderJob[] = [
  ...SPECS.builds.map(({ id, spec }) => ({ id, kind: "build" as const, spec })),
  ...SPECS.edits.map(({ id, base, spec }) => ({
    base,
    id,
    kind: "edit" as const,
    spec,
  })),
];

// A page the owner can open and play: the served page with its scripts inlined.
const inline = (text: string) =>
  text.replaceAll("</script", String.raw`<\/script`);
export const previewHtml = (files: Record<string, string>) => {
  const game = `<script>${inline(files["game.js"] ?? "")}</script>`;
  const page = files["index.html"];
  if (page && !isLittlejsHtml(page)) {
    return page
      .replace(
        /<script src="\/dom\/v1\.js"><\/script>/u,
        () => `<script>${inline(readFileSync(DOM_RUNTIME, "utf-8"))}</script>`
      )
      .replace(/<script src="game\.js"><\/script>/u, () => game);
  }
  const music = files[MUSIC] ? `<script>${files[MUSIC]}</script>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#000;overflow:hidden;touch-action:none}</style></head><body><script>${inline(readFileSync(RUNTIME, "utf-8"))}</script>${music}${game}</body></html>`;
};

type Judged = Awaited<ReturnType<typeof judgeCoder>> | { error: string };
const atLeast4 = (score?: { score: number }) => (score?.score ?? 0) >= 4;

export const passes = (
  kind: CoderJob["kind"],
  finalGreen: boolean,
  scores: Judged | undefined
) => {
  const judged = scores && !("error" in scores) ? scores : undefined;
  return (
    finalGreen &&
    atLeast4(judged?.spec) &&
    atLeast4(judged?.playable) &&
    (kind === "build" || atLeast4(judged?.edit))
  );
};

export const warningsOf = (
  playtests: ({ warnings?: string[] } | undefined)[]
) => [...new Set(playtests.flatMap((playtest) => playtest?.warnings ?? []))];

// A run's result.json. null is what a Preview doesn't report (report.ts leaves it out of a stat).
export interface CoderRecord {
  agent: "coder";
  cost: number | null;
  finalGreen: boolean;
  firstGreen: boolean | null;
  job: string;
  judge?: Judged;
  kind: CoderJob["kind"];
  model: string;
  music: boolean;
  pass: boolean;
  playtests: number;
  reason?: string;
  run: number;
  seconds: number;
  steps: number;
  warnings: string[];
}
