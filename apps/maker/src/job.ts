// How the Coder does a build job, whatever runs the agent: the job and its events, the prompt, the playtest, the
// workspace a job starts from and the Revision it ends with. It reaches the box only through `Box`, so a Coder on any
// box runs it unchanged (#173); the Worker's adapts its Container (jobBox in apps/worker/src/agent-sandbox.ts).
import { Schema } from "effect";

import { domHtml, isLittlejsHtml, littlejsHtml, MUSIC } from "../image/page.ts";

export const WORKSPACE = "/workspace";

// What a job needs of its box: run a program in the workspace from its argv, with no shell (its output whatever the
// exit code), and read and write files at absolute paths. `read` and `readBytes` throw on a missing file; `write` makes
// the file's parent directories. No shell, so nothing a model left in the box (a ~/.bash_profile, a function, a fake
// `node` on PATH) runs in place of the harness's commands.
export interface Box {
  exec: (
    argv: string[]
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  read: (file: string) => Promise<string>;
  readBytes: (file: string) => Promise<Uint8Array>;
  write: (file: string, text: string) => Promise<void>;
}

// #116's turn limits. Steps are the owner's call, raised from #111's 12 to 20 on 2026-11-03: a p95 cap of 10 failed 2
// of 72 good builds. The deadline is the owner's call too, raised from 210 s to 5 minutes on 2026-11-09 with the move to
// Sonnet at high effort. The turn's abort timer sits 30 s past it (#122).
export const MAX_STEPS = 20;
export const DEADLINE_MS = 300_000;
// Harness repairs per build (ADR 0005): a check that fails sends the errors back this many times, then the build fails.
export const MAX_REPAIRS = 3;
const MUSIC_MIN_S = 20;
const MUSIC_MAX_S = 40;

export const SYSTEM_PROMPT = `You are the sub agent in hopon, an app where people make small phone games by chatting. You get one build job from the main agent, who talks to the Creator: a new game to make, or a change to the game in the workspace. The brief names the engine and ends with the success criteria under "Done when:". You build it, playtest it until it meets every criterion, and report back to the main agent. You never talk to the Creator.

When the work the user asked for is done and checked, stop and report. Don't add features, tests, files, docs or refactors that weren't asked for. If you think one would help, mention it at the end instead of doing it.

Your tools run in the game's workspace, a sandbox with no network. Follow the project instructions below.`;

// The main agent's tests of a build (ADR 0005): the game values they read, which the sub agent keeps on a
// top-level `testVars` in game.ts, and the tests the harness runs on every check.
const TestsSchema = Schema.Struct({
  expose: Schema.Array(
    Schema.Struct({ means: Schema.String, name: Schema.String })
  ),
  tests: Schema.Array(
    Schema.Struct({
      checks: Schema.Array(
        Schema.Struct({ at: Schema.Number, expect: Schema.String })
      ),
      inputs: Schema.Array(Schema.Unknown),
      name: Schema.String,
    })
  ),
});
export type Tests = typeof TestsSchema.Type;

// The job from the Talker (#122), decoded at the server's door.
export const JobSchema = Schema.Struct({
  draftId: Schema.String,
  // The Revision the job starts from, 0 when the Draft has none.
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  // game.ts, index.html, music.mjs or music.py; never game.js or music.js. Empty for a new game, a start over included.
  source: Schema.Record(Schema.String, Schema.String),
  spec: Schema.Struct({
    brief: Schema.String,
    // genre and mood when this build writes or rewrites the music, else null
    music: Schema.NullOr(Schema.String),
    tests: Schema.optional(TestsSchema),
    title: Schema.String,
  }),
});
export type Job = typeof JobSchema.Type;
export type Spec = Job["spec"];

export interface PlaytestResult {
  ok: boolean;
  errors: string[];
  typeErrors: string[];
  warnings?: string[];
  state?: string;
  score?: number;
  clock?: number;
  identical?: boolean;
  overAt?: number;
  // Real ms by phase.
  timings?: Record<string, number>;
}

export type CoderEvent =
  | { type: "step"; label: string }
  | { type: "playtest"; ok: boolean; errors: string[] }
  | {
      type: "done";
      summary: string;
      files: Record<string, string>;
      deleted: string[];
    }
  | { type: "failed"; reason: string };

// The image's binaries by full path, so a program a model put earlier on PATH can't stand in for one.
const NODE = "/usr/local/bin/node";
const PYTHON = "/usr/bin/python3";
const PLAYTEST = "/opt/hopon/playtest.js";

// What a playtest.js run that printed no result left: its exit code always, since one killed by a signal or by
// `timeout` prints nothing at all.
const crashed = (result: Awaited<ReturnType<Box["exec"]>>, line: string) =>
  `exit ${result.exitCode}: ${(result.stderr || line).slice(0, 500)}`;

// `arg` is the playtest's JSON ({inputs, ms}).
export const boxPlaytest = async (box: Box, arg: string) => {
  const result = await box.exec([NODE, PLAYTEST, arg]);
  const line = result.stdout.trim().split("\n").at(-1) ?? "";
  try {
    return JSON.parse(line) as PlaytestResult;
  } catch {
    return {
      errors: [`playtest crashed: ${crashed(result, line)}`],
      ok: false,
      typeErrors: [],
    } satisfies PlaytestResult;
  }
};

export const screenshots = async (box: Box) =>
  await Promise.all(
    ["playtest-start.png", "playtest-end.png"].map(async (file) => ({
      data: Buffer.from(await box.readBytes(`${WORKSPACE}/${file}`)).toString(
        "base64"
      ),
      mimeType: "image/png",
      type: "image" as const,
    }))
  );

const readText = async (box: Box, file: string) => {
  try {
    return await box.read(`${WORKSPACE}/${file}`);
  } catch {
    return null;
  }
};

// A game's music is one score that renders music.wav: music.mjs synthesizes it (the music-synth skill), music.py
// plays it on recorded instruments (music-sf2). Each runs on its own interpreter, and its error is where that one
// prints it: a Node error's message comes first, a Python traceback's last.
const SCORES = {
  "music.mjs": { error: (stderr: string) => stderr.slice(0, 300), run: NODE },
  "music.py": { error: (stderr: string) => stderr.slice(-300), run: PYTHON },
} as const;
type Score = keyof typeof SCORES;
const SCORE_FILES = Object.keys(SCORES) as Score[];

// What a Revision holds of the sub agent's (#117); the harness adds game.js, music.js and a LittleJS game's index.html,
// and a plain-DOM game's index.html gets the music's script from it.
const SOURCE_FILES = ["index.html", "game.ts", ...SCORE_FILES];
const HOME = "/home/user";

// music.js: the harness's, from music.wav. GAME_CSP has connect-src 'none', so the Opus loop comes in as a script, in
// base64, for the runtime to decode in Web Audio (#146).
export const musicScript = (opus: Uint8Array) =>
  `hopon.music = "${Buffer.from(opus).toString("base64")}";\n`;

// The workspace's score to music.opus, or why it failed.
const renderMusic = async (box: Box, source: Record<string, string | null>) => {
  const scores = SCORE_FILES.filter((file) => source[file] !== null);
  const [score] = scores;
  if (score === undefined) {
    return `no music: write ${SCORE_FILES.join(" or ")}`;
  }
  if (scores.length > 1) {
    return `${scores.join(" and ")} are both there: a game has one music file, so delete the one you aren't using`;
  }
  const { error, run } = SCORES[score];
  const rendered = await box.exec([run, `${WORKSPACE}/${score}`]);
  if (rendered.exitCode !== 0) {
    return `${score} failed: ${error(rendered.stderr)}`;
  }
  const probed = await box.exec([
    "/usr/bin/ffprobe",
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    `${WORKSPACE}/music.wav`,
  ]);
  const seconds = Number(probed.stdout.trim());
  if (
    probed.exitCode !== 0 ||
    !(seconds >= MUSIC_MIN_S && seconds <= MUSIC_MAX_S)
  ) {
    return `music.wav is ${probed.stdout.trim() || "missing"} s, not ${MUSIC_MIN_S}–${MUSIC_MAX_S} s`;
  }
  const encoded = await box.exec([
    "/usr/bin/ffmpeg",
    "-y",
    "-loglevel",
    "error",
    "-i",
    `${WORKSPACE}/music.wav`,
    "-c:a",
    "libopus",
    "-b:a",
    "64k",
    `${WORKSPACE}/music.opus`,
  ]);
  return encoded.exitCode === 0
    ? null
    : `music.wav didn't encode: ${encoded.stderr.slice(0, 300)}`;
};

export const stepLabel = (tool: string, args: Record<string, unknown>) => {
  if (tool === "playtest") {
    return "Playtesting";
  }
  // pi-durable's Coder loads skills with activate_skill; pi-coding-agent's reads their SKILL.md.
  if (tool === "activate_skill") {
    return "Reading the docs";
  }
  if (tool === "read") {
    return String(args.path).includes("SKILL.md")
      ? "Reading the docs"
      : "Reading the game";
  }
  if (tool === "bash" && String(args.command).includes("music")) {
    return "Writing music";
  }
  return tool === "edit" ? "Fixing the game" : "Writing the game";
};

const hasTests = (tests: Tests | undefined): tests is Tests =>
  (tests?.tests.length ?? 0) > 0;

// The harness's own test, ahead of the main agent's on every check: the game loads, starts and plays a second with no
// console error. With no test from the main agent it is the whole of "does the game run".
const RUNS: Tests["tests"][number] = {
  checks: [{ at: 1000, expect: "state !== undefined" }],
  inputs: [],
  name: "the game runs",
};

const testsPrompt = (tests: Tests) =>
  [
    "",
    "Tests: the harness runs these on your game and fails the build until every one passes. Keep each value below up to date every frame, from the game's real state, on a top-level object in game.ts: `const testVars: Record<string, number | string | boolean> = {};` (keep it when you change the game).",
    ...tests.expose.map(({ means, name }) => `- testVars.${name}: ${means}`),
    "Each test loads the game, taps (180, 320) to start, waits 500 ms, then sends its inputs at their `at` (ms) and evaluates each check's expression at its `at` over `vars` (testVars), `score`, `state` (hopon's) and `prev`, the same three at the check before (`prev.vars`, `prev.score`, `prev.state`). Save the tests below as tests.json and run them with `node /opt/hopon/playtest.js tests`.",
    JSON.stringify(tests),
  ].join("\n");

export const prompt = ({ revision, source, spec }: Job) =>
  [
    Object.keys(source).length === 0
      ? "Build a new game."
      : `Change the game in the workspace (Revision ${revision}).`,
    `Title: ${spec.title}`,
    `Brief: ${spec.brief}`,
    spec.music
      ? `Music: write the music for this game (${spec.music}) and render music.wav.`
      : "Music: none this turn; leave any existing music file as it is.",
    ...(hasTests(spec.tests) ? [testsPrompt(spec.tests)] : []),
  ].join("\n");

interface TestsResult {
  ok: boolean;
  failures: string[];
  // Checks whose expression threw: the main agent's mistakes, skipped rather than sent back to the sub agent.
  testErrors: string[];
  typeErrors: string[];
}

const boxTests = async (box: Box, tests: Tests): Promise<TestsResult> => {
  const result = await box.exec([
    NODE,
    PLAYTEST,
    "tests",
    JSON.stringify(tests),
  ]);
  const line = result.stdout.trim().split("\n").at(-1) ?? "";
  try {
    return JSON.parse(line) as TestsResult;
  } catch {
    return {
      failures: [`tests crashed: ${crashed(result, line)}`],
      ok: false,
      testErrors: [],
      typeErrors: [],
    };
  }
};

// What the harness says to the sub agent when its check fails, or the box lost the job's work.
export const repairPrompt = (errors: readonly string[]) =>
  [
    "The harness ran your game and it failed:",
    ...errors.map((error) => `- ${error}`),
    "Fix these, playtest again, then give your report.",
  ].join("\n");
export const RESTARTED =
  "The sandbox restarted, and the workspace is back to how it was when the job began: your changes are gone. Make them again, playtest, then give your report.";

// The Revision's changed and deleted files, against the source the job sent. The harness adds its own two: a LittleJS
// game's index.html, and music.js when the job rendered music. A Revision has music.js when this job rendered it or
// the last one did and its score is still there; index.html loads it exactly then.
const diffRevision = (
  workspace: Record<string, string | null>,
  source: Job["source"],
  opus: Uint8Array | null
) => {
  const hadMusic = SCORE_FILES.some((file) => file in source);
  const music =
    opus !== null ||
    SCORE_FILES.some((file) => workspace[file] !== null && file in source);
  const revision = { ...workspace };
  // Only a plain-DOM game has index.html in the box: restore keeps the harness's page out.
  const page = revision["index.html"];
  if (page === null && revision["game.ts"] !== null) {
    revision["index.html"] = littlejsHtml(music);
  } else if (page !== null) {
    revision["index.html"] = domHtml(page, music);
  }
  const files: Record<string, string> = {};
  const deleted: string[] = [];
  for (const [file, text] of Object.entries(revision)) {
    if (text === null && file in source) {
      deleted.push(file);
    } else if (text !== null && text !== source[file]) {
      files[file] = text;
    }
  }
  if (opus) {
    files[MUSIC] = musicScript(opus);
  } else if (!music && hadMusic) {
    deleted.push(MUSIC);
  }
  return { deleted, files };
};

// The workspace and the home directory emptied. Processes a model left are not ended: under the durable_object policy
// every process has root's capabilities, so kill(-1) could end Cloudflare's own, and a model that means to cheat could
// rewrite the harness anyway. checkBuild instead reads the source again after running it.
const sweep = async (box: Box) => {
  await box.exec([
    "/usr/bin/find",
    WORKSPACE,
    HOME,
    "-mindepth",
    "1",
    "-delete",
  ]);
};

const write = async (box: Box, files: Record<string, string | null>) => {
  await Promise.all(
    Object.entries(files).flatMap(([file, text]) =>
      text === null ? [] : [box.write(`${WORKSPACE}/${file}`, text)]
    )
  );
};

// The workspace holds exactly the job's source, but for index.html. A LittleJS game's is the harness's, not the sub
// agent's, and in the box it would make the game look like plain DOM. A plain-DOM game's goes in on the current
// scaffold and without the music's script, which the harness adds back. A box left dirty by a failed or stopped job
// starts from Revision n.
export const restore = async (box: Box, source: Job["source"]) => {
  await sweep(box);
  await write(
    box,
    Object.fromEntries(
      Object.entries(source).flatMap(([file, text]) => {
        if (file !== "index.html") {
          return [[file, text]];
        }
        return isLittlejsHtml(text) ? [] : [[file, domHtml(text, false)]];
      })
    )
  );
};

export const pastDeadline = (seconds: number) =>
  `past the ${seconds} s deadline`;

// The harness's check of a build (ADR 0005), each time the sub agent stops: the music rendered, the source read into
// memory, the box swept and given back only that source, then the game typechecked, emitted and run through RUNS and
// the main agent's tests, and the source read again to show nothing rewrote it meanwhile. Its errors, or the
// Revision's files, which hold exactly what it ran. Whatever the model claims, a game that doesn't run never becomes a
// Revision (#122), and game.js always comes from game.ts. It replays no playtest and plays no random script: in 46
// recorded builds those two failed 2, both on a playtest that printed nothing, and caught no broken game.
export const checkBuild = async (
  box: Box,
  { job }: { job: Job }
): Promise<
  (
    | { errors: string[] }
    | { files: Record<string, string>; deleted: string[] }
  ) & { testErrors?: string[] }
> => {
  const texts = await Promise.all(
    SOURCE_FILES.map((file) => readText(box, file))
  );
  const source = Object.fromEntries(
    SOURCE_FILES.map((file, index) => [file, texts[index] ?? null])
  );
  const music = job.spec.music ? await renderMusic(box, source) : null;
  const opus =
    job.spec.music && music === null
      ? await box.readBytes(`${WORKSPACE}/music.opus`)
      : null;
  await sweep(box);
  await write(box, source);
  if (music !== null) {
    return { errors: [music] };
  }
  const tested = await boxTests(box, {
    expose: job.spec.tests?.expose ?? [],
    tests: [RUNS, ...(job.spec.tests?.tests ?? [])],
  });
  const { testErrors } = tested;
  if (!tested.ok) {
    return {
      errors: [...tested.typeErrors, ...tested.failures],
      testErrors,
    };
  }
  const [emitted, ...after] = await Promise.all(
    ["game.js", ...SOURCE_FILES].map((file) => readText(box, file))
  );
  const changed = SOURCE_FILES.filter(
    (file, index) => (after[index] ?? null) !== source[file]
  );
  if (changed.length > 0) {
    return {
      errors: changed.map(
        (file) =>
          `${file} changed while the harness ran it: stop whatever process is writing it`
      ),
    };
  }
  return {
    ...diffRevision({ ...source, "game.js": emitted }, job.source, opus),
    testErrors,
  };
};
