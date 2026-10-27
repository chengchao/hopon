// One Coder run of the eval: the job, the harness's own final playtests (the Coder's last inputs, then the fixed
// 10 s random script), the judge, and everything the report and the owner's blind scoring need, under out/.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { isLittlejsHtml, MUSIC } from "../image/page.ts";
import { createBox, EVAL_TEMPLATE, jobBox } from "../src/box.ts";
import { runJob } from "../src/coder.ts";
import type { Thinking } from "../src/coder.ts";
import { boxPlaytest, WORKSPACE } from "../src/job.ts";
import type { Box, Spec } from "../src/job.ts";
import { resolve } from "../src/models.ts";
import { judgeCoder } from "./judge.ts";

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
export const SMOKE_JOBS = SPECS.builds
  .filter((build) => build.spike)
  .map((build) => build.id);

// The source files a job carries (#122): never game.js or music.js, and not the owner's preview.html.
const SOURCE_FILES = new Set(["game.ts", "index.html", "music.mjs"]);
export const readRevision = (base: string) => {
  const dir = path.join(REVISIONS, base);
  if (!existsSync(dir)) {
    throw new Error(
      `no frozen Revision for ${base}: run \`pnpm -F maker eval freeze\` first`
    );
  }
  return Object.fromEntries(
    readdirSync(dir)
      .filter((file) => SOURCE_FILES.has(file))
      .map((file) => [file, readFileSync(path.join(dir, file), "utf-8")])
  );
};

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

const readBytes = async (box: Box, file: string) => {
  try {
    return Buffer.from(await box.readBytes(`${WORKSPACE}/${file}`));
  } catch {
    return null;
  }
};

// The eval's own checks on the final game: the Coder's last inputs replayed, then the fixed random script. The
// random run's screenshots are the ones kept and judged.
const finalChecks = async (box: Box, inputs: unknown[]) => {
  const replay = await boxPlaytest(box, JSON.stringify({ inputs }));
  const random = await boxPlaytest(box, "random");
  return { random, replay };
};

// The game, its screenshots, its music and a playable preview, for the report and the owner.
const saveArtifacts = async (
  box: Box,
  dir: string,
  files: Record<string, string>
) => {
  for (const [file, text] of Object.entries(files)) {
    writeFileSync(path.join(dir, file), text);
  }
  const [start, end] = await Promise.all(
    ["playtest-start.png", "playtest-end.png"].map((file) =>
      readBytes(box, file)
    )
  );
  for (const [file, bytes] of [
    ["start.png", start],
    ["end.png", end],
  ] as const) {
    if (bytes) {
      writeFileSync(path.join(dir, file), bytes);
    }
  }
  if (files["game.js"]) {
    writeFileSync(path.join(dir, "preview.html"), previewHtml(files));
  }
  return { end, start };
};

const atLeast4 = (score?: { score: number }) => (score?.score ?? 0) >= 4;

export const passes = (
  kind: CoderJob["kind"],
  finalGreen: boolean,
  scores: Awaited<ReturnType<typeof judgeCoder>> | { error: string } | undefined
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

export const runCoder = async ({
  modelId,
  job,
  run,
  dir,
  judge = true,
  thinking = "low",
  revision,
}: {
  modelId: string;
  job: CoderJob;
  run: number;
  dir: string;
  judge?: boolean;
  thinking?: Thinking;
  // The end-to-end run's Draft: the current Revision's files and number, instead of a frozen base.
  revision?: { n: number; source: Record<string, string> };
}) => {
  mkdirSync(dir, { recursive: true });
  const source = revision?.source ?? (job.base ? readRevision(job.base) : {});
  const n = revision?.n ?? (job.base ? 1 : 0);
  const events: unknown[] = [];
  const model = resolve(modelId);
  const sandbox = await createBox(EVAL_TEMPLATE);
  const box = jobBox(sandbox);
  try {
    const result = await runJob({
      job: {
        draftId: `eval-${job.id}-${run}`,
        revision: n,
        source,
        spec: job.spec,
      },
      model,
      onEvent: (event) =>
        events.push({
          at: Date.now(),
          ...event,
          ...("files" in event && { files: Object.keys(event.files) }),
        }),
      sandbox,
      thinking,
    });
    const final = result.ok
      ? await finalChecks(box, result.lastInputs)
      : undefined;
    const finalGreen = final?.replay.ok === true && final.random.ok;
    // The judge reads the game, not music.js's base64.
    const { [MUSIC]: _music, ...files } = { ...source, ...result.files };
    const { start, end } = await saveArtifacts(box, dir, {
      ...source,
      ...result.files,
    });

    // Only a game that could become a Revision is judged; a red one fails anyway.
    const scores =
      judge && final
        ? await judgeCoder({
            end: end?.toString("base64"),
            files,
            original: n > 0 ? source : undefined,
            signals: final.random,
            spec: job.spec,
            start: start?.toString("base64"),
          }).catch((error: unknown) => ({ error: String(error) }))
        : undefined;
    const record = {
      agent: "coder",
      cost: result.usage.cost,
      errors: result.errors,
      events,
      final,
      finalGreen,
      firstGreen: result.firstGreen,
      imagesSent: result.imagesSent,
      job: job.id,
      judge: scores,
      kind: job.kind,
      model: modelId,
      music: Boolean(job.spec.music),
      pass: passes(job.kind, finalGreen, scores),
      playtests: result.playtests.length,
      reason: result.reason,
      run,
      seconds: result.seconds,
      steps: result.steps,
      summary: result.summary,
      thinking,
      toolCalls: result.toolCalls,
      turns: result.turns,
      usage: result.usage,
      warnings: warningsOf([...result.playtests, final?.random, final?.replay]),
    };
    writeFileSync(
      path.join(dir, "result.json"),
      JSON.stringify(record, null, 2)
    );
    return record;
  } finally {
    await sandbox.kill();
  }
};

export type CoderRecord = Awaited<ReturnType<typeof runCoder>>;
