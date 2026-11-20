// What the Maker's harness does in the box, whatever runs the agent: the playtest, the workspace a run starts from, and
// the check that turns the workspace into a Revision. It reaches the box only through `Box`, so it runs unchanged on
// any box (#173); the Worker's adapts its Container (jobBox in apps/worker/src/agent-sandbox.ts).
import { Schema } from "effect";

import { domHtml, isLittlejsHtml } from "../image/page.ts";

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
  write: (file: string, data: string | Uint8Array) => Promise<void>;
}

// A message's limits (ADR 0009): money and steps, not time. Steps were #111's 12, the owner's 20 on 2026-11-03, and 30
// from P6a, once the 5-minute deadline that bound first went: a step late in a run reads ~56K cached tokens, ~$0.015.
export const MAX_STEPS = 30;
// `build` calls per message (ADR 0006): a failed check comes back as errors to fix, this many times in all.
export const MAX_BUILDS = 4;
// A safety ceiling against a broken loop, not a budget: no normal run comes near it. Past it the agent may still
// publish a finished game with one last `build`.
export const RUN_CEILING_MS = 20 * 60_000;
const MUSIC_MIN_S = 20;
const MUSIC_MAX_S = 40;

// The agent's tests of its game (tests.json): the game values they read, which it keeps on a top-level `testVars` in
// game.ts, and the tests the harness runs on every check.
export const TestsSchema = Schema.Struct({
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

// The eval's build spec: whether the build has music and which tests it runs, and what the judge grades the game
// against.
export interface Spec {
  brief: string;
  // genre and mood when the build has music, else null
  music: string | null;
  tests?: Tests;
  title: string;
}

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

// The image's binaries by full path, so a program a model put earlier on PATH can't stand in for one.
const NODE = "/usr/local/bin/node";
const PYTHON = "/usr/bin/python3";
const FIND = "/usr/bin/find";
const TAR = "/usr/bin/tar";
const STAT = "/usr/bin/stat";
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

// A game's music is one score that renders music.wav: music.mjs synthesizes it (make-game's music-synth guide), music.py
// plays it on recorded instruments (music-sf2). Each runs on its own interpreter, and its error is where that one
// prints it: a Node error's message comes first, a Python traceback's last.
const SCORES = {
  "music.mjs": { error: (stderr: string) => stderr.slice(0, 300), run: NODE },
  "music.py": { error: (stderr: string) => stderr.slice(-300), run: PYTHON },
} as const;
type Score = keyof typeof SCORES;
export const SCORE_FILES = Object.keys(SCORES) as Score[];
const HOME = "/home/user";

// A Revision (ADR 0006): source.tgz, the workspace's source, and the built game the page loads, dist/'s files, the
// music the harness renders among them.
export const SOURCE_TAR = "source.tgz";
export const MUSIC_FILE = "music.opus";
const DIST = "dist";
// The source is the workspace but what the playtest builds, the scores' renders at its top (music.wav and a skeleton's
// raw.wav and song.mid; a game's own .wav or .mid elsewhere stays), the music, the screenshots, and the Worker's .hopon/
// (the Creator's messages, written again on every run). It's packed the same way every time (names sorted, times and
// owners zeroed, gzip without a name or a time), so the same source is the same bytes.
const NOT_SOURCE = [
  "./dist",
  "./game.js",
  "./music.wav",
  "./raw.wav",
  "./song.mid",
  `./${MUSIC_FILE}`,
  "./playtest-*.png",
  "./node_modules",
  "./.hopon",
];
const PACKED = "/tmp/hopon-source.tgz";
const GZIP = "--use-compress-program=/usr/bin/gzip -n";
const TAR_CHANGED = 1;
const CHANGED =
  "the workspace changed while the harness ran it: stop whatever process is writing to it";
// What the page loads (the scaffold aside) and the source packed, each: a game's needs are well under these, and a
// phone loads the first on every swipe to the game.
const MAX_BUILT_BYTES = 5_000_000;
const MAX_SOURCE_BYTES = 5_000_000;
// The names the Worker serves a game's files by (apps/worker/src/api.ts).
const SERVED_NAME = /^[\w.-]+$/u;

// What restore puts back in the workspace: a Revision's source.tgz, or the source files of a Revision from before it.
export type Source = { tar: Uint8Array } | { files: Record<string, string> };

// Where the check runs the score: what it writes besides music.wav stays out of the workspace, which the check compares.
const RENDERS = "/tmp/hopon-music";

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
  await box.exec(["/usr/bin/rm", "-rf", RENDERS]);
  await box.exec(["/usr/bin/mkdir", "-p", RENDERS]);
  const rendered = await box.exec([
    "/usr/bin/env",
    "-C",
    RENDERS,
    run,
    `${WORKSPACE}/${score}`,
  ]);
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
    `${RENDERS}/music.wav`,
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
    `${RENDERS}/music.wav`,
    "-c:a",
    "libopus",
    "-b:a",
    "64k",
    `${WORKSPACE}/${MUSIC_FILE}`,
  ]);
  return encoded.exitCode === 0
    ? null
    : `music.wav didn't encode: ${encoded.stderr.slice(0, 300)}`;
};

export const stepLabel = (tool: string, args: Record<string, unknown>) => {
  if (tool === "playtest") {
    return "Playtesting";
  }
  // pi-durable's agents load skills with activate_skill and their guides with read_skill_resource; pi-coding-agent's
  // read their SKILL.md.
  if (tool === "activate_skill" || tool === "read_skill_resource") {
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

// The harness's own test, ahead of the agent's tests.json on every check: the game loads, starts and plays a second
// with no console error. With no other test it is the whole of "does the game run".
const RUNS: Tests["tests"][number] = {
  checks: [{ at: 1000, expect: "state !== undefined" }],
  inputs: [],
  name: "the game runs",
};

interface TestsResult {
  ok: boolean;
  failures: string[];
  // Checks whose expression threw: mistakes in tests.json, skipped rather than failing the game.
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

// The workspace and the home directory emptied. Processes a model left are not ended: under the durable_object policy
// every process has root's capabilities, so kill(-1) could end Cloudflare's own, and a model that means to cheat could
// rewrite the harness anyway. checkBuild instead packs the source again after running it.
const sweep = async (box: Box) => {
  await box.exec([FIND, WORKSPACE, HOME, "-mindepth", "1", "-delete"]);
};

const run = async (box: Box, argv: string[]) => {
  const result = await box.exec(argv);
  if (result.exitCode !== 0) {
    throw new Error(
      `${argv.slice(0, 2).join(" ")} failed: ${result.stderr.slice(0, 300)}`
    );
  }
  return result.stdout;
};

// The workspace's source packed into PACKED, in the box: its size in bytes, or null when a file changed while tar read
// it (tar's exit 1, as when a process the model left is still writing).
const pack = async (box: Box) => {
  const packed = await box.exec([
    TAR,
    "--create",
    "--file",
    PACKED,
    GZIP,
    "--format=gnu",
    "--sort=name",
    "--mtime=@0",
    "--owner=0",
    "--group=0",
    "--numeric-owner",
    ...NOT_SOURCE.map((pattern) => `--exclude=${pattern}`),
    "-C",
    WORKSPACE,
    ".",
  ]);
  if (packed.exitCode === TAR_CHANGED) {
    return null;
  }
  if (packed.exitCode !== 0) {
    throw new Error(`${TAR} --create failed: ${packed.stderr.slice(0, 300)}`);
  }
  return Number(await run(box, [STAT, "--format=%s", PACKED]));
};

// The workspace's source as source.tgz's bytes.
export const packSource = async (box: Box) => {
  if ((await pack(box)) === null) {
    throw new Error(CHANGED);
  }
  return await box.readBytes(PACKED);
};

// The workspace swept and given back exactly this source.
const unpackSource = async (box: Box, tar: Uint8Array) => {
  await sweep(box);
  await box.write(PACKED, tar);
  await run(box, [
    TAR,
    "--extract",
    "--file",
    PACKED,
    GZIP,
    "--no-same-owner",
    "-C",
    WORKSPACE,
  ]);
};

// A Revision from before source.tgz: its source files, but for index.html. A LittleJS game's is the harness's, not the
// agent's, and in the box it would make the game look like plain DOM. A plain-DOM game's goes in on the current
// scaffold and without the music's script, which the playtest's build replaces.
const writeFiles = async (box: Box, files: Record<string, string>) => {
  await sweep(box);
  await Promise.all(
    Object.entries(files).flatMap(([file, text]) => {
      if (file !== "index.html") {
        return [box.write(`${WORKSPACE}/${file}`, text)];
      }
      return isLittlejsHtml(text)
        ? []
        : [box.write(`${WORKSPACE}/${file}`, domHtml(text))];
    })
  );
};

// The workspace holds exactly the Revision's source. A box left dirty by a failed or stopped job starts from Revision n.
export const restore = async (box: Box, source: Source) => {
  await ("tar" in source
    ? unpackSource(box, source.tar)
    : writeFiles(box, source.files));
};

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

const tooBig = (bytes: number) =>
  `the built game is ${(bytes / 1e6).toFixed(1)} MB, over ${MAX_BUILT_BYTES / 1e6} MB: make its images and sounds smaller`;
const sourceTooBig = (bytes: number) =>
  `the workspace's source is ${(bytes / 1e6).toFixed(1)} MB packed, over ${MAX_SOURCE_BYTES / 1e6} MB: delete what the game doesn't use`;

// dist/'s files, or why the page can't load them. Their sizes come from the box first, so an oversized game is never
// read into the Worker, and what was read is measured again, since a file can grow in between. Names end in NUL, the
// one byte a file name can't hold.
const readBuilt = async (box: Box) => {
  const listed = await run(box, [
    FIND,
    `${WORKSPACE}/${DIST}`,
    "-maxdepth",
    "1",
    "-type",
    "f",
    "-printf",
    "%s %f\\0",
  ]);
  const files = listed
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const space = line.indexOf(" ");
      return {
        name: line.slice(space + 1),
        size: Number(line.slice(0, space)),
      };
    });
  const unserved = files
    .map(({ name }) => name)
    .filter((name) => !SERVED_NAME.test(name));
  if (unserved.length > 0) {
    return `rename ${unserved.join(", ")}: a game's file names are letters, digits, ".", "-" and "_"`;
  }
  const bytes = files.reduce((total, { size }) => total + size, 0);
  if (bytes > MAX_BUILT_BYTES) {
    return tooBig(bytes);
  }
  const read = await Promise.all(
    files.map(
      async ({ name }) =>
        [name, await box.readBytes(`${WORKSPACE}/${DIST}/${name}`)] as const
    )
  );
  const readBytes = read.reduce((total, [, data]) => total + data.length, 0);
  return readBytes > MAX_BUILT_BYTES
    ? tooBig(readBytes)
    : Object.fromEntries(read);
};

// The harness's check of a build (ADR 0006), at each `build` call: the source packed, the box swept and given back only
// that source, the music rendered, then the game built, typechecked and run through RUNS and the agent's tests, and the
// source packed again to show nothing rewrote it meanwhile. Its errors, or the Revision's files, which hold exactly what
// it ran. Whatever the model claims, a game that doesn't run never becomes a Revision (#122), and the page always comes
// from the source. It replays no playtest and plays no random script: in 46 recorded builds those two failed 2, both on
// a playtest that printed nothing, and caught no broken game.
export const checkBuild = async (
  box: Box,
  { music, tests }: { music: boolean; tests?: Tests }
): Promise<
  ({ errors: string[] } | { files: Record<string, Uint8Array> }) & {
    testErrors?: string[];
  }
> => {
  const size = await pack(box);
  if (size === null) {
    return { errors: [CHANGED] };
  }
  if (size > MAX_SOURCE_BYTES) {
    return { errors: [sourceTooBig(size)] };
  }
  const tar = await box.readBytes(PACKED);
  if (tar.length > MAX_SOURCE_BYTES) {
    return { errors: [sourceTooBig(tar.length)] };
  }
  await unpackSource(box, tar);
  const scores = await Promise.all(
    SCORE_FILES.map((file) => readText(box, file))
  );
  if (music || scores.some((text) => text !== null)) {
    const failed = await renderMusic(
      box,
      Object.fromEntries(
        SCORE_FILES.map((file, index) => [file, scores[index]])
      )
    );
    if (failed !== null) {
      return { errors: [failed] };
    }
  }
  const tested = await boxTests(box, {
    expose: tests?.expose ?? [],
    tests: [RUNS, ...(tests?.tests ?? [])],
  });
  const { testErrors } = tested;
  if (!tested.ok) {
    return { errors: [...tested.typeErrors, ...tested.failures], testErrors };
  }
  if (
    (await pack(box)) !== tar.length ||
    !sameBytes(await box.readBytes(PACKED), tar)
  ) {
    return { errors: [CHANGED], testErrors };
  }
  const built = await readBuilt(box);
  if (typeof built === "string") {
    return { errors: [built], testErrors };
  }
  return { files: { ...built, [SOURCE_TAR]: tar }, testErrors };
};
