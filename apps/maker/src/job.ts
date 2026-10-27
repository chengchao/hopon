// How the Coder does a build job, whatever runs the agent: the job and its events, the prompt, the playtest, the
// workspace a job starts from and the Revision it ends with. It reaches the box only through `Box`, so a Coder on any
// box runs it unchanged (#173); today's adapts its E2B sandbox (jobBox in box.ts).
import { Schema } from "effect";

import { isLittlejsHtml, littlejsHtml, MUSIC } from "../image/page.ts";

export const WORKSPACE = "/workspace";

// What a job needs of its box: run a command in the workspace (its output whatever the exit code), and read and write
// files at absolute paths. `read` and `readBytes` throw on a missing file; `write` makes the file's parent directories.
export interface Box {
  run: (
    command: string
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  read: (file: string) => Promise<string>;
  readBytes: (file: string) => Promise<Uint8Array>;
  write: (file: string, text: string) => Promise<void>;
}

// #116's turn limits. Seconds from the chosen Coder's p95 (Haiku 5.5 at low effort, building from the Talker's specs:
// 112 s; music builds 142 s), rounded up. Steps stay at #111's 12, the owner's call: a p95 cap of 10 failed 2 of 72
// good builds, and the deadline already bounds the wait. The Talker's abort timer sits 30 s past the deadline (#122).
export const MAX_STEPS = 12;
export const DEADLINE_MS = 120_000;
const MUSIC_EXTRA_MS = 30_000;
export const deadlineFor = (job: { spec: { music: string | null } }) =>
  DEADLINE_MS + (job.spec.music ? MUSIC_EXTRA_MS : 0);
const MUSIC_MIN_S = 20;
const MUSIC_MAX_S = 40;

export const SYSTEM_PROMPT = `You are the Coder in hopon, an app where people make small phone games by chatting. You get one build job from the Talker, who talks to the Creator: a new game to make, or a change to the game in the workspace. You build it, playtest it until it is green, and report back to the Talker. You never talk to the Creator.

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

const playtestCommand = (arg: string) =>
  `node /opt/hopon/playtest.js '${arg.replaceAll("'", String.raw`'\''`)}'`;

export const boxPlaytest = async (box: Box, arg: string) => {
  const result = await box.run(playtestCommand(arg));
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

// What the Creator would get: the files a Revision holds (#117), besides music.js.
const REVISION_FILES = ["index.html", "game.ts", "game.js", "music.mjs"];

// music.js: the harness's, from music.wav. GAME_CSP has connect-src 'none', so the Opus loop comes in as a script, in
// base64, for the runtime to decode in Web Audio (#146).
export const musicScript = (opus: Uint8Array) =>
  `hopon.music = "${Buffer.from(opus).toString("base64")}";\n`;

const renderMusic = async (box: Box) => {
  const result = await box.run(
    `node music.mjs >/dev/null && ffprobe -v error -show_entries format=duration -of csv=p=0 music.wav && ffmpeg -y -loglevel error -i music.wav -c:a libopus -b:a 64k music.opus`
  );
  const seconds = Number(result.stdout.trim());
  if (result.exitCode !== 0) {
    return `music.mjs failed: ${result.stderr.slice(0, 300)}`;
  }
  return seconds >= MUSIC_MIN_S && seconds <= MUSIC_MAX_S
    ? null
    : `music.wav is ${seconds} s, not ${MUSIC_MIN_S}–${MUSIC_MAX_S} s`;
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

// The Revision's changed and deleted files, against the source the job sent. The harness adds its own two: a LittleJS
// game's index.html, and music.js when the job rendered music. A Revision has music.js when this job rendered it or
// the last one did and music.mjs is still there; index.html loads it exactly then.
const diffRevision = async (
  box: Box,
  source: Job["source"],
  rendered: boolean
) => {
  const texts = await Promise.all(
    REVISION_FILES.map((file) => readText(box, file))
  );
  const workspace = Object.fromEntries(
    REVISION_FILES.map((file, index) => [file, texts[index] ?? null])
  );
  const music =
    rendered || (workspace["music.mjs"] !== null && "music.mjs" in source);
  // Only a plain-DOM game has index.html in the box: restore keeps the harness's page out.
  if (workspace["index.html"] === null && workspace["game.ts"] !== null) {
    workspace["index.html"] = littlejsHtml(music);
  }
  const files: Record<string, string> = {};
  const deleted: string[] = [];
  for (const [file, text] of Object.entries(workspace)) {
    if (text === null && file in source) {
      deleted.push(file);
    } else if (text !== null && text !== source[file]) {
      files[file] = text;
    }
  }
  if (rendered) {
    files[MUSIC] = musicScript(await box.readBytes(`${WORKSPACE}/music.opus`));
  } else if (!music && "music.mjs" in source) {
    deleted.push(MUSIC);
  }
  return { deleted, files };
};

// The workspace holds exactly the job's source, but for a LittleJS game's index.html: the harness's, not the Coder's,
// and in the box it would make the game look like plain DOM. A box left dirty by a failed or stopped job starts from
// Revision n.
export const restore = async (box: Box, source: Job["source"]) => {
  await box.run(`find ${WORKSPACE} -mindepth 1 -delete`);
  await Promise.all(
    Object.entries(source)
      .filter(([file, text]) => file !== "index.html" || !isLittlejsHtml(text))
      .map(([file, text]) => box.write(`${WORKSPACE}/${file}`, text))
  );
};

export const pastDeadline = (seconds: number) =>
  `past the ${seconds} s deadline`;
// Music rendering and reading the files back run after the session; a job that finished them late still fails.
const overdue = (deadlineAt: number, seconds: number) =>
  Date.now() > deadlineAt ? pastDeadline(seconds) : undefined;

// A build without a green playtest never becomes a Revision (#122).
const failure = (stopped: string | undefined, playtests: PlaytestResult[]) => {
  if (stopped || playtests.at(-1)?.ok === true) {
    return stopped;
  }
  return playtests.length === 0
    ? "never playtested"
    : "last playtest not green";
};

// The job's ending, once the agent has stopped: the reason it failed (stopped, red, music that won't render, late),
// or the Revision's files, with music.js rendered when the job wrote music.
export const finishJob = async (
  box: Box,
  {
    job,
    stopped,
    playtests,
    summary,
    deadlineAt,
    deadlineMs,
  }: {
    job: Job;
    stopped: string | undefined;
    playtests: PlaytestResult[];
    summary: string;
    deadlineAt: number;
    deadlineMs: number;
  }
) => {
  let reason = failure(stopped, playtests);
  if (!reason && job.spec.music) {
    reason = (await renderMusic(box)) ?? reason;
  }
  const { deleted, files } = await diffRevision(
    box,
    job.source,
    !reason && Boolean(job.spec.music)
  );
  reason ??= overdue(deadlineAt, deadlineMs / 1000);
  const event: CoderEvent = reason
    ? { reason, type: "failed" }
    : { deleted, files, summary, type: "done" };
  return { event, files, reason };
};
