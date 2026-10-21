// The Coder (#122): one build job in, events out. A fresh pi-coding-agent session per job, pi's read/bash/edit/write
// plus a playtest tool executing in the Draft's E2B box, the job's source written over the workspace first. The eval
// runs it in-process; the Container will wrap the same function in POST /jobs/:jobId.
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { InMemoryCredentialStore, Type } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
  CreateAgentSessionOptions,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Sandbox } from "e2b";

import { createBox, run, WORKSPACE } from "./box.ts";
import { apiKey, createRegistry, resolve } from "./models.ts";
import { createE2BTools } from "./ops.ts";

const AGENT_HOME = path.join(import.meta.dirname, "..", "agent-home");
// #116's turn limits, from the chosen Coder's p95 (Haiku 5.5 at low effort, building from the Talker's specs: 10
// steps, 112 s; music builds 142 s), rounded up. The Talker's abort timer sits 30 s past the deadline (#122).
export const MAX_STEPS = 10;
export const DEADLINE_MS = 120_000;
const MUSIC_EXTRA_MS = 30_000;
const deadlineFor = (job: { spec: { music: string | null } }) =>
  DEADLINE_MS + (job.spec.music ? MUSIC_EXTRA_MS : 0);
const MUSIC_MIN_S = 20;
const MUSIC_MAX_S = 40;

const SYSTEM_PROMPT = `You are the Coder in hopon, an app where people make small phone games by chatting. You get one build job from the Talker, who talks to the Creator: a new game to make, or a change to the game in the workspace. You build it, playtest it until it is green, and report back to the Talker. You never talk to the Creator.

Your tools run in the game's workspace, a sandbox with no network. Follow the project instructions below.`;

export interface Spec {
  title: string;
  brief: string;
  music: string | null;
}

export interface Job {
  draftId: string;
  revision: number;
  source: Record<string, string>;
  spec: Spec;
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

const Input = Type.Object({
  at: Type.Number({ description: "ms after the start tap" }),
  dx: Type.Optional(Type.Number({ description: "swipe distance, CSS px" })),
  dy: Type.Optional(Type.Number({ description: "swipe distance, CSS px" })),
  type: Type.Union([Type.Literal("tap"), Type.Literal("swipe")]),
  x: Type.Number(),
  y: Type.Number(),
});
type Inputs = { at: number; type: "tap" | "swipe"; x: number; y: number }[];

const playtestCommand = (arg: string) =>
  `node /opt/hopon/playtest.js '${arg.replaceAll("'", String.raw`'\''`)}'`;

export const boxPlaytest = async (sandbox: Sandbox, arg: string) => {
  const result = await run(sandbox, playtestCommand(arg));
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

const readText = async (sandbox: Sandbox, file: string) => {
  try {
    return await sandbox.files.read(`${WORKSPACE}/${file}`);
  } catch {
    return null;
  }
};

// What the Creator would get: the files a Revision holds (#117). music.opus is the harness's, from music.wav.
const REVISION_FILES = ["index.html", "game.ts", "game.js", "music.mjs"];

const renderMusic = async (sandbox: Sandbox) => {
  const result = await run(
    sandbox,
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

const stepLabel = (tool: string, args: Record<string, unknown>) => {
  if (tool === "playtest") {
    return "Playtesting";
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

export type Thinking = NonNullable<CreateAgentSessionOptions["thinkingLevel"]>;

export interface RunOptions {
  modelId: string;
  job: Job;
  onEvent?: (event: CoderEvent) => void;
  maxSteps?: number;
  deadlineMs?: number;
  // Keeps the box for the caller's own checks (the eval's final playtest); the caller kills it.
  keepBox?: boolean;
  // "off" breaks Claude 5.5; low is the floor that works everywhere (#115).
  thinking?: Thinking;
}

// Eyes for a Coder model without image input (the owner's idea, 2026-10-19): Haiku 5.5 looks at both screenshots
// and describes them, and the Coder gets the description instead. Its cost counts toward the job's.
const EYES_PROMPT = `You are the eyes of a game coder that cannot see images. Below are screenshots of a phone game (360×640), taken just after a tap that starts it and at the end of a scripted playtest, plus the brief the game was built from. In under 120 words, describe what is on screen in each, then list anything that looks wrong: blank or frozen screens, nothing changing, unreadable text, things off-screen or overlapping, or a look that doesn't match the brief. No code.`;
const describeScreenshots = async (
  images: { data: string; mimeType: string; type: "image" }[],
  brief: string
) => {
  const message = await createRegistry().completeSimple(
    resolve("claude-haiku-5-5"),
    {
      messages: [
        {
          content: [{ text: `Brief: ${brief}`, type: "text" }, ...images],
          role: "user",
          timestamp: Date.now(),
        },
      ],
      systemPrompt: EYES_PROMPT,
    },
    { reasoning: "low" }
  );
  const text = message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("");
  return {
    cost: message.usage.cost.total,
    text: `Screenshots, described by a vision model:\n${text || message.errorMessage}`,
  };
};

const screenshots = async (sandbox: Sandbox) =>
  await Promise.all(
    ["playtest-start.png", "playtest-end.png"].map(async (file) => ({
      data: Buffer.from(
        await sandbox.files.read(`${WORKSPACE}/${file}`, { format: "bytes" })
      ).toString("base64"),
      mimeType: "image/png",
      type: "image" as const,
    }))
  );

// pi's session for one job: the loader's cwd is a copy of agent-home (AGENTS.md, skills), so pi's ancestor walk finds
// nothing of this repo's; the session's cwd is the box's workspace.
const openSession = async (
  modelId: string,
  sandbox: Sandbox,
  // oxlint-disable-next-line no-explicit-any -- pi's own ToolDefinition<any, any>
  playtestTool: ToolDefinition<any, any>,
  thinking: Thinking
) => {
  const model = resolve(modelId);
  const home = mkdtempSync(path.join(tmpdir(), "hopon-coder-"));
  cpSync(AGENT_HOME, home, { recursive: true });
  // The REST route for Haiku speaks Anthropic's protocol; pi's runtime knows it as the anthropic provider.
  const piModel =
    model.provider === "cloudflare-rest"
      ? { ...model, provider: "anthropic" }
      : model;
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
  });
  await modelRuntime.setRuntimeApiKey(piModel.provider, apiKey(model));
  const resourceLoader = new DefaultResourceLoader({
    additionalSkillPaths: [path.join(home, ".agents", "skills")],
    agentDir: path.join(home, ".pi"),
    cwd: home,
    noExtensions: true,
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true,
    systemPrompt: SYSTEM_PROMPT,
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    agentDir: path.join(home, ".pi"),
    customTools: [
      ...createE2BTools(WORKSPACE, { localRoots: [home], sandbox }),
      playtestTool,
    ],
    cwd: WORKSPACE,
    model: piModel,
    modelRuntime,
    noTools: "builtin",
    resourceLoader,
    sessionManager: SessionManager.inMemory(WORKSPACE),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
    }),
    thinkingLevel: thinking,
  });
  return session;
};

const totalUsage = (assistant: AssistantMessage[]) => {
  const usage = { cacheRead: 0, cacheWrite: 0, cost: 0, input: 0, output: 0 };
  for (const { usage: turn } of assistant) {
    usage.cost += turn.cost.total;
    usage.input += turn.input;
    usage.cacheRead += turn.cacheRead;
    usage.cacheWrite += turn.cacheWrite;
    usage.output += turn.output;
  }
  return usage;
};

// The Revision's changed and deleted files, against the source the job sent.
const diffRevision = async (sandbox: Sandbox, source: Job["source"]) => {
  const texts = await Promise.all(
    REVISION_FILES.map((file) => readText(sandbox, file))
  );
  const files: Record<string, string> = {};
  const deleted: string[] = [];
  for (const [index, file] of REVISION_FILES.entries()) {
    const text = texts[index];
    if (text === null && file in source) {
      deleted.push(file);
    } else if (text !== null && text !== source[file]) {
      files[file] = text;
    }
  }
  return { deleted, files };
};

export const runJob = async ({
  modelId,
  job,
  onEvent,
  maxSteps = MAX_STEPS,
  deadlineMs,
  keepBox = false,
  thinking = "low",
}: RunOptions) => {
  const started = Date.now();
  const sandbox = await createBox();
  await Promise.all(
    Object.entries(job.source).map(([file, text]) =>
      sandbox.files.write(`${WORKSPACE}/${file}`, text)
    )
  );

  const playtests: PlaytestResult[] = [];
  let lastInputs: Inputs = [];
  let imagesSent = 0;
  let eyesCost = 0;
  const seesImages = resolve(modelId).input.includes("image");
  const playtestTool = defineTool({
    description:
      "Typecheck and play the game in headless Chromium (360×640): loads it, taps the centre to start, runs your inputs, and returns the result with screenshots of the start and the end.",
    execute: async (_id, { inputs }) => {
      lastInputs = (inputs ?? []) as Inputs;
      const result = await boxPlaytest(
        sandbox,
        JSON.stringify({ inputs: lastInputs })
      );
      playtests.push(result);
      onEvent?.({
        errors: [...result.typeErrors, ...result.errors],
        ok: result.ok,
        type: "playtest",
      });
      const images =
        result.typeErrors.length > 0 ? [] : await screenshots(sandbox);
      imagesSent += images.length;
      if (!seesImages && images.length > 0) {
        const eyes = await describeScreenshots(images, job.spec.brief);
        eyesCost += eyes.cost;
        return {
          content: [
            { text: JSON.stringify(result), type: "text" },
            { text: eyes.text, type: "text" },
          ],
          details: undefined,
        };
      }
      return {
        content: [{ text: JSON.stringify(result), type: "text" }, ...images],
        details: undefined,
      };
    },
    label: "Playtest",
    name: "playtest",
    parameters: Type.Object({
      inputs: Type.Optional(
        Type.Array(Input, {
          description:
            "Taps and swipes for your game's controls, in CSS px; 3 s of play when empty",
        })
      ),
    }),
    promptSnippet: "Typecheck and play the game, with screenshots",
  });
  const session = await openSession(modelId, sandbox, playtestTool, thinking);

  let steps = 0;
  let limit: string | undefined;
  const errors: string[] = [];
  const toolCalls: { tool: string; ms: number; command?: string }[] = [];
  const commands = new Map<string, string>();
  const startedAt = new Map<string, number>();
  session.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      steps += 1;
      commands.set(event.toolCallId, String(event.args?.command ?? ""));
      startedAt.set(event.toolCallId, Date.now());
      if (steps > maxSteps) {
        limit = `over ${maxSteps} steps`;
        void session.abort();
        return;
      }
      onEvent?.({ label: stepLabel(event.toolName, event.args), type: "step" });
    } else if (event.type === "tool_execution_end") {
      toolCalls.push({
        ms: Date.now() - (startedAt.get(event.toolCallId) ?? Date.now()),
        tool: event.toolName,
        ...(event.toolName === "bash" && {
          command: String(commands.get(event.toolCallId) ?? "").slice(0, 120),
        }),
      });
    } else if (
      event.type === "message_end" &&
      event.message.role === "assistant" &&
      (event.message as AssistantMessage).stopReason === "error"
    ) {
      errors.push((event.message as AssistantMessage).errorMessage ?? "error");
    }
  });
  const deadlineAfter = deadlineMs ?? deadlineFor(job);
  const deadline = setTimeout(() => {
    limit = `past the ${deadlineAfter / 1000} s deadline`;
    void session.abort();
  }, deadlineAfter);
  try {
    await session.prompt(prompt(job));
  } catch (error) {
    errors.push(String(error));
  }
  clearTimeout(deadline);

  const assistant = session.messages.filter(
    (message): message is AssistantMessage => message.role === "assistant"
  );
  const usage = totalUsage(assistant);
  const summary = (assistant.at(-1)?.content ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("")
    .trim();
  session.dispose();

  // A build without a green playtest never becomes a Revision (#122).
  let reason: string | undefined = limit ?? errors[0];
  if (!reason && playtests.at(-1)?.ok !== true) {
    reason =
      playtests.length === 0 ? "never playtested" : "last playtest not green";
  }
  if (!reason && job.spec.music) {
    reason = (await renderMusic(sandbox)) ?? reason;
  }
  const { deleted, files } = await diffRevision(sandbox, job.source);
  const seconds = (Date.now() - started) / 1000;
  onEvent?.(
    reason
      ? { reason, type: "failed" }
      : { deleted, files, summary, type: "done" }
  );
  if (!keepBox) {
    await sandbox.kill();
  }
  return {
    errors,
    files,
    firstGreen: playtests[0]?.ok === true,
    imagesSent,
    lastInputs,
    model: modelId,
    ok: !reason,
    playtests,
    reason,
    sandbox,
    seconds,
    steps,
    summary,
    thinking,
    toolCalls,
    turns: assistant.length,
    // The eyes' Haiku calls are part of the job's cost.
    usage: { ...usage, cost: usage.cost + eyesCost, eyes: eyesCost },
  };
};

export type CoderRun = Awaited<ReturnType<typeof runJob>>;
