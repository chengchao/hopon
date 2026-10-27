// The Coder (#122): one build job in, events out. A fresh pi-coding-agent session per job, pi's read/bash/edit/write
// plus a playtest tool executing in the Draft's E2B box, the job's source written over the workspace first. What the
// job does in the box (job.ts) goes through jobBox. The eval runs it in-process; the Worker's Coder (apps/worker/src/
// coder.ts) runs the same job rules on pi-durable.
import { once } from "node:events";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { InMemoryCredentialStore, Type } from "@earendil-works/pi-ai";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
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

import { jobBox } from "./box.ts";
import {
  boxPlaytest,
  deadlineFor,
  finishJob,
  MAX_STEPS,
  pastDeadline,
  prompt,
  restore,
  screenshots,
  stepLabel,
  SYSTEM_PROMPT,
  WORKSPACE,
} from "./job.ts";
import type { CoderEvent, Job, PlaytestResult } from "./job.ts";
import { apiKey } from "./models.ts";
import { createE2BTools } from "./ops.ts";

const AGENT_HOME = path.join(import.meta.dirname, "..", "agent-home");
// pi settles within moments of an abort; this bounds a tool call that doesn't, so a stopped job still ends on time.
const SETTLE_MS = 5000;
const Input = Type.Object({
  at: Type.Number({ description: "ms after the start tap" }),
  dx: Type.Optional(Type.Number({ description: "swipe distance, CSS px" })),
  dy: Type.Optional(Type.Number({ description: "swipe distance, CSS px" })),
  type: Type.Union([Type.Literal("tap"), Type.Literal("swipe")]),
  x: Type.Number(),
  y: Type.Number(),
});
type Inputs = { at: number; type: "tap" | "swipe"; x: number; y: number }[];

export type Thinking = NonNullable<CreateAgentSessionOptions["thinkingLevel"]>;

export interface RunOptions {
  model: Model<Api>;
  job: Job;
  // The Draft's box; the caller opens it and pauses or kills it after.
  sandbox: Sandbox;
  onEvent?: (event: CoderEvent) => void;
  // The Talker's cancel: the job ends `failed`.
  signal?: AbortSignal;
  maxSteps?: number;
  deadlineMs?: number;
  // When the job reached the Coder; the deadline counts from here. The server passes it, so opening the box counts.
  startedAt?: number;
  // "off" breaks Claude 5.5; low is the floor that works everywhere (#115).
  thinking?: Thinking;
}

// pi's session for one job: the loader's cwd is a copy of agent-home (AGENTS.md, skills), so pi's ancestor walk finds
// nothing of this repo's; the session's cwd is the box's workspace.
const openSession = async (
  model: Model<Api>,
  sandbox: Sandbox,
  // oxlint-disable-next-line no-explicit-any -- pi's own ToolDefinition<any, any>
  playtestTool: ToolDefinition<any, any>,
  thinking: Thinking
) => {
  const home = mkdtempSync(path.join(tmpdir(), "hopon-coder-"));
  cpSync(AGENT_HOME, home, { recursive: true });
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
  });
  await modelRuntime.setRuntimeApiKey(model.provider, apiKey(model));
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
    model,
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

export const runJob = async ({
  model,
  job,
  sandbox,
  onEvent,
  signal,
  maxSteps = MAX_STEPS,
  deadlineMs = deadlineFor(job),
  startedAt = Date.now(),
  thinking = "low",
}: RunOptions) => {
  const deadlineAt = startedAt + deadlineMs;
  const box = jobBox(sandbox);
  await restore(box, job.source);

  const playtests: PlaytestResult[] = [];
  let lastInputs: Inputs = [];
  let imagesSent = 0;
  const playtestTool = defineTool({
    description:
      "Typecheck and play the game in headless Chromium (360×640): loads it, taps the centre to start, runs your inputs, and returns the result with screenshots of the start and the end.",
    execute: async (_id, { inputs }) => {
      lastInputs = (inputs ?? []) as Inputs;
      const result = await boxPlaytest(
        box,
        JSON.stringify({ inputs: lastInputs })
      );
      playtests.push(result);
      onEvent?.({
        errors: [...result.typeErrors, ...result.errors],
        ok: result.ok,
        type: "playtest",
      });
      const images = result.typeErrors.length > 0 ? [] : await screenshots(box);
      imagesSent += images.length;
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
  const session = await openSession(model, sandbox, playtestTool, thinking);

  let steps = 0;
  // Why the job was stopped: the step limit, the deadline or a cancel. pi's abort ends the model request too (see
  // abortable in models.ts).
  let limit: string | undefined;
  const halted = new AbortController();
  const halt = (reason: string) => {
    limit ??= reason;
    void session.abort();
    halted.abort();
  };
  const errors: string[] = [];
  const toolCalls: { tool: string; ms: number; command?: string }[] = [];
  const commands = new Map<string, string>();
  const toolStartedAt = new Map<string, number>();
  session.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      steps += 1;
      commands.set(event.toolCallId, String(event.args?.command ?? ""));
      toolStartedAt.set(event.toolCallId, Date.now());
      if (steps > maxSteps) {
        halt(`over ${maxSteps} steps`);
        return;
      }
      onEvent?.({ label: stepLabel(event.toolName, event.args), type: "step" });
    } else if (event.type === "tool_execution_end") {
      toolCalls.push({
        ms: Date.now() - (toolStartedAt.get(event.toolCallId) ?? Date.now()),
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
  const deadline = setTimeout(
    () => halt(pastDeadline(deadlineMs / 1000)),
    Math.max(0, deadlineAt - Date.now())
  );
  const cancel = () => halt("cancelled");
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) {
    cancel();
  }
  // A job stopped before its prompt (cancelled while the box opened) never prompts.
  const prompted = async () => {
    if (halted.signal.aborted) {
      return;
    }
    try {
      await session.prompt(prompt(job));
    } catch (error) {
      errors.push(String(error));
    }
  };
  const settled = async () => {
    if (!halted.signal.aborted) {
      await once(halted.signal, "abort");
    }
    await sleep(SETTLE_MS, undefined, { ref: false });
  };
  await Promise.race([prompted(), settled()]);
  clearTimeout(deadline);
  signal?.removeEventListener("abort", cancel);

  const assistant = session.messages.filter(
    (message): message is AssistantMessage => message.role === "assistant"
  );
  const usage = totalUsage(assistant);
  const summary = (assistant.at(-1)?.content ?? [])
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("")
    .trim();
  session.dispose();

  const { event, files, reason } = await finishJob(box, {
    deadlineAt,
    deadlineMs,
    job,
    playtests,
    stopped: limit ?? errors[0],
    summary,
  });
  const seconds = (Date.now() - startedAt) / 1000;
  onEvent?.(event);
  return {
    errors,
    files,
    firstGreen: playtests[0]?.ok === true,
    imagesSent,
    lastInputs,
    model: model.id,
    ok: !reason,
    playtests,
    reason,
    seconds,
    steps,
    summary,
    thinking,
    toolCalls,
    turns: assistant.length,
    usage,
  };
};

export type CoderRun = Awaited<ReturnType<typeof runJob>>;
