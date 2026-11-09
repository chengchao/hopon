// How the Coder does a build job, whatever runs the agent: the job and its events, the prompt, the playtest, the
// workspace a job starts from and the Revision it ends with. It reaches the box only through `Box`, so a Coder on any
// box runs it unchanged (#173); the Worker's adapts its Container (jobBox in apps/worker/src/agent-sandbox.ts).
import { Schema } from "effect";

import { isLittlejsHtml, littlejsHtml, MUSIC } from "../image/page.ts";

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
// of 72 good builds. The deadline is #116's p95 (112 s, music 142 s) plus the harness check, about 30 s a pass and up to
// 3 repairs (ADR 0005); a guess the control sweep checks. The turn's abort timer sits 30 s past it (#122).
export const MAX_STEPS = 20;
export const DEADLINE_MS = 210_000;
// Harness repairs per build (ADR 0005): a check that fails sends the errors back this many times, then the build fails.
export const MAX_REPAIRS = 3;
const MUSIC_MIN_S = 20;
const MUSIC_MAX_S = 40;

export const SYSTEM_PROMPT = `You are the sub agent in hopon, an app where people make small phone games by chatting. You get one build job from the main agent, who talks to the Creator: a new game to make, or a change to the game in the workspace. The brief names the engine and ends with the success criteria under "Done when:". You build it, playtest it until it meets every criterion, and report back to the main agent. You never talk to the Creator.

Your tools run in the game's workspace, a sandbox with no network. Follow the project instructions below.`;

// The job from the Talker (#122), decoded at the server's door.
export const JobSchema = Schema.Struct({
  draftId: Schema.String,
  // 0 for a new game
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  // game.ts, index.html, music.mjs; never game.js or music.js
  source: Schema.Record(Schema.String, Schema.String),
  spec: Schema.Struct({
    brief: Schema.String,
    // genre and mood when this build writes or rewrites the music, else null
    music: Schema.NullOr(Schema.String),
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
const PLAYTEST = "/opt/hopon/playtest.js";

// `arg` is the playtest's JSON ({inputs, ms}) or "random", the fixed 10 s script.
export const boxPlaytest = async (box: Box, arg: string) => {
  const result = await box.exec([NODE, PLAYTEST, arg]);
  const line = result.stdout.trim().split("\n").at(-1) ?? "";
  try {
    return JSON.parse(line) as PlaytestResult;
  } catch {
    return {
      errors: [`playtest crashed: ${(result.stderr || line).slice(0, 500)}`],
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

// What a Revision holds of the sub agent's (#117); the harness adds game.js, music.js and a LittleJS game's index.html.
const SOURCE_FILES = ["index.html", "game.ts", "music.mjs"];
const HOME = "/home/user";

// music.js: the harness's, from music.wav. GAME_CSP has connect-src 'none', so the Opus loop comes in as a script, in
// base64, for the runtime to decode in Web Audio (#146).
export const musicScript = (opus: Uint8Array) =>
  `hopon.music = "${Buffer.from(opus).toString("base64")}";\n`;

// music.mjs to music.opus, or why it failed.
const renderMusic = async (box: Box) => {
  const rendered = await box.exec([NODE, `${WORKSPACE}/music.mjs`]);
  if (rendered.exitCode !== 0) {
    return `music.mjs failed: ${rendered.stderr.slice(0, 300)}`;
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

export const prompt = ({ revision, spec }: Job) =>
  [
    revision === 0
      ? "Build a new game."
      : `Change the game in the workspace (Revision ${revision}).`,
    `Title: ${spec.title}`,
    `Brief: ${spec.brief}`,
    spec.music
      ? `Music: write music.mjs for this game (${spec.music}) and render music.wav.`
      : "Music: none this turn; leave any existing music.mjs as it is.",
  ].join("\n");

// What the harness says to the sub agent when its check fails, or the box lost the job's work.
export const repairPrompt = (errors: readonly string[]) =>
  [
    "The harness played your game and it failed:",
    ...errors.map((error) => `- ${error}`),
    "Fix these, playtest again, then give your report.",
  ].join("\n");
export const RESTARTED =
  "The sandbox restarted, and the workspace is back to how it was when the job began: your changes are gone. Make them again, playtest, then give your report.";

// The Revision's changed and deleted files, against the source the job sent. The harness adds its own two: a LittleJS
// game's index.html, and music.js when the job rendered music. A Revision has music.js when this job rendered it or
// the last one did and music.mjs is still there; index.html loads it exactly then.
const diffRevision = (
  workspace: Record<string, string | null>,
  source: Job["source"],
  opus: Uint8Array | null
) => {
  const music =
    opus !== null || (workspace["music.mjs"] !== null && "music.mjs" in source);
  const revision = { ...workspace };
  // Only a plain-DOM game has index.html in the box: restore keeps the harness's page out.
  if (revision["index.html"] === null && revision["game.ts"] !== null) {
    revision["index.html"] = littlejsHtml(music);
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
  } else if (!music && "music.mjs" in source) {
    deleted.push(MUSIC);
  }
  return { deleted, files };
};

// The workspace and the home directory emptied. Processes a model left are not ended: under the durable_object policy
// every process has root's capabilities, so kill(-1) could end Cloudflare's own, and a model that means to cheat could
// rewrite the harness anyway. checkBuild instead reads the source again after playing it.
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

// The workspace holds exactly the job's source, but for a LittleJS game's index.html: the harness's, not the sub
// agent's, and in the box it would make the game look like plain DOM. A box left dirty by a failed or stopped job
// starts from Revision n.
export const restore = async (box: Box, source: Job["source"]) => {
  await sweep(box);
  await write(
    box,
    Object.fromEntries(
      Object.entries(source).filter(
        ([file, text]) => file !== "index.html" || !isLittlejsHtml(text)
      )
    )
  );
};

export const pastDeadline = (seconds: number) =>
  `past the ${seconds} s deadline`;

const played = (result: PlaytestResult, run: string) => [
  ...result.typeErrors,
  ...result.errors.map((error) => `${run}: ${error}`),
];

// The harness's check of a build (ADR 0005), each time the sub agent stops: the music rendered, the source read into
// memory, the box swept and given back only that source, then the game played with the sub agent's last inputs and
// with the fixed random script, and the source read again to show nothing rewrote it meanwhile. Its errors, or the
// Revision's files, which hold exactly what it played. Whatever the
// model claims, a game that doesn't run never becomes a Revision (#122), and game.js always comes from game.ts.
export const checkBuild = async (
  box: Box,
  { job, inputs }: { job: Job; inputs: string | undefined }
): Promise<
  { errors: string[] } | { files: Record<string, string>; deleted: string[] }
> => {
  const music = job.spec.music ? await renderMusic(box) : null;
  const texts = await Promise.all(
    SOURCE_FILES.map((file) => readText(box, file))
  );
  const source = Object.fromEntries(
    SOURCE_FILES.map((file, index) => [file, texts[index] ?? null])
  );
  const opus =
    job.spec.music && music === null
      ? await box.readBytes(`${WORKSPACE}/music.opus`)
      : null;
  await sweep(box);
  await write(box, source);
  if (music !== null) {
    return { errors: [music] };
  }
  const theirs = await boxPlaytest(box, inputs ?? "{}");
  if (!theirs.ok) {
    return { errors: played(theirs, "your inputs") };
  }
  const random = await boxPlaytest(box, "random");
  if (!random.ok) {
    return { errors: played(random, "random taps") };
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
          `${file} changed while the harness played it: stop whatever process is writing it`
      ),
    };
  }
  return diffRevision({ ...source, "game.js": emitted }, job.source, opus);
};
