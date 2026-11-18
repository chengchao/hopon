// The end-to-end run against a deployed Worker Preview (#174): what ships, playtest timings on Cloudflare included. A
// Clerk Development user drives each scripted chat through the app's own Draft routes and WebSocket; each build's
// Revision is read back through its preview link, playtested here as the box does (the eval's final checks), judged,
// and recorded as the in-process runs before #178 were, so the same report reads both.
import { execFile } from "node:child_process";
import { once } from "node:events";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

import type {
  AssistantMessage,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import type { AgentEvent } from "@earendil-works/pi-durable";

import { isLittlejsHtml, MUSIC } from "../image/page.ts";
import { stepLabel } from "../src/job.ts";
import type { PlaytestResult, Spec } from "../src/job.ts";
import { passes, previewHtml, warningsOf } from "./coder.ts";
import type { CoderJob } from "./coder.ts";
import { judgeCoder } from "./judge.ts";
import { judgeChat, turnRecord } from "./talker.ts";
import type { Chat } from "./talker.ts";

// A Revision's files (the Worker's build.ts writes them to R2), and the ones a job carries.
const REVISION_FILES = [
  "index.html",
  "game.ts",
  "game.js",
  "music.mjs",
  "music.py",
  MUSIC,
];
const SOURCE_FILES = ["game.ts", "index.html", "music.mjs", "music.py"];
const PLAYTEST = path.join(import.meta.dirname, "..", "image", "playtest.js");
// What the Preview doesn't report. Not 0: a stat leaves these runs out (report.ts).
const UNKNOWN = null;
// As talker.ts: a steer lands a second into the build.
const STEER_AFTER_MS = 1000;
const PING_MS = 20_000;
const RECONNECT_MS = 1000;
const RETRIES = 3;
const OPEN_MS = 30_000;
const POLL_MS = 100;
const TURN_MS = 10 * 60_000;
// Clerk Development instances sign in any `+clerk_test` address with this code, and send no email.
const TEST_CODE = "424242";
// Session tokens live 60 s.
const TOKEN_MS = 30_000;
const BUILD_FAILED = /^The build failed: /u;

// Signs in as the eval's Clerk Development user through Clerk's Frontend API, as the app's native client does, and
// hands out fresh session tokens.
export const signIn = async () => {
  const key = process.env.CLERK_PUBLISHABLE_KEY ?? "";
  const email = process.env.EVAL_CLERK_EMAIL ?? "";
  if (!(key && email.includes("+clerk_test"))) {
    throw new Error(
      "Set CLERK_PUBLISHABLE_KEY and EVAL_CLERK_EMAIL (a +clerk_test address of a Development user) in apps/maker/.env"
    );
  }
  // pk_test_<base64 of "<frontend api host>$">
  const host = Buffer.from(key.split("_")[2] ?? "", "base64")
    .toString()
    .replace(/\$$/u, "");
  let client = "";
  const post = async (route: string, body: Record<string, string> = {}) => {
    const response = await fetch(
      `https://${host}/v1/${route}?_is_native=true`,
      {
        body: new URLSearchParams(body),
        headers: client ? { Authorization: client } : {},
        method: "POST",
      }
    );
    client = response.headers.get("authorization") ?? client;
    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(`Clerk ${route}: ${JSON.stringify(json.errors)}`);
    }
    return json;
  };
  const begun = await post("client/sign_ins", { identifier: email });
  const attempt = begun.response as {
    id: string;
    supported_first_factors: { strategy: string; email_address_id?: string }[];
  };
  const factor = attempt.supported_first_factors.find(
    (each) => each.strategy === "email_code"
  );
  await post(`client/sign_ins/${attempt.id}/prepare_first_factor`, {
    email_address_id: factor?.email_address_id ?? "",
    strategy: "email_code",
  });
  const signedIn = await post(
    `client/sign_ins/${attempt.id}/attempt_first_factor`,
    { code: TEST_CODE, strategy: "email_code" }
  );
  const session = (signedIn.response as { created_session_id: string })
    .created_session_id;
  let token = { at: 0, jwt: "" };
  return async () => {
    if (Date.now() - token.at > TOKEN_MS) {
      const fresh = await post(`client/sessions/${session}/tokens`);
      token = { at: Date.now(), jwt: String(fresh.jwt) };
    }
    return token.jwt;
  };
};

// The box's playtest (image/playtest.js), here: in a workspace that holds what restore() leaves in the box.
const playtest = async (cwd: string, arg: string) => {
  let output = { stderr: "", stdout: "" };
  try {
    output = await promisify(execFile)(process.execPath, [PLAYTEST, arg], {
      cwd,
    });
  } catch (error) {
    // Red exits 1, with its result on stdout.
    const { stderr = String(error), stdout = "" } = error as {
      stderr?: string;
      stdout?: string;
    };
    output = { stderr, stdout };
  }
  const line = output.stdout.trim().split("\n").at(-1) ?? "";
  try {
    return JSON.parse(line) as PlaytestResult;
  } catch {
    return {
      errors: [`playtest crashed: ${(output.stderr || line).slice(0, 500)}`],
      ok: false,
      typeErrors: [],
    } satisfies PlaytestResult;
  }
};

// The eval's final check of a built game, in dir/box: the fixed random script, whose screenshots are kept and judged.
// No replay: the Preview doesn't report the Coder's last inputs, and with none a game that waits for a tap looks
// frozen (#179: 10 of 67 builds failed only that).
const finalChecks = async (dir: string, files: Record<string, string>) => {
  const box = path.join(dir, "box");
  mkdirSync(box, { recursive: true });
  for (const file of SOURCE_FILES) {
    const text = files[file];
    // As restore(): a LittleJS game's index.html is the harness's, and in the box it would look like plain DOM.
    if (
      text !== undefined &&
      !(file === "index.html" && isLittlejsHtml(text))
    ) {
      writeFileSync(path.join(box, file), text);
    }
  }
  const random = await playtest(box, "random");
  const [start, end] = ["start", "end"].map((shot) => {
    const png = path.join(box, `playtest-${shot}.png`);
    if (existsSync(png)) {
      copyFileSync(png, path.join(dir, `${shot}.png`));
    }
    return existsSync(png) ? readFileSync(png).toString("base64") : undefined;
  });
  return { end, final: { random }, start };
};

// One build as the Draft's socket showed it: the two agents' `build` call's spec, its step labels and its result. The
// one agent's (ADR 0006) is reconstructed from a run's tool calls (singleBuilds).
interface Build {
  callId: string;
  // The `build` call's arguments: the job's spec and whether it changes the game or makes a new one.
  spec: Spec & { kind?: "new" | "change" };
  startedAt: number;
  endedAt?: number;
  labels: string[];
  // When each label reached the socket. The Worker sends a label as the model finishes that tool call, so a gap is
  // the previous tool's run plus the model writing the next call.
  labelAt: number[];
  result?: ToolResultMessage;
  // The single agent's: its model calls' dollars and output tokens, from the run's own messages.
  cost?: number;
  outputTokens?: number;
}

// A tool call of the root conversation, for the single agent's builds.
interface ToolCall {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  run: number;
  startedAt: number;
  endedAt?: number;
  result?: ToolResultMessage;
}

// What the socket shows of the turn in flight.
interface Turn {
  sentAt: number;
  sent: string[];
  // The Creator's messages in the chat so far, this turn's last: the single agent's builds are judged against them.
  asked: string[];
  // When the Worker last accepted one of the turn's messages: a snapshot from before then can't show it.
  acceptedAt?: number;
  answered: Map<string, string | undefined>;
  texts: string[];
  cost: number;
  firstToken?: number;
  firstVisible?: number;
  builds: Map<string, Build>;
  // Every tool call and assistant message of the turn, by the run it came in (counted from run_start).
  tools: Map<string, ToolCall>;
  messages: { run: number; at: number; cost: number; output: number }[];
  run: number;
  // The largest snapshot frame the socket got during the turn, in bytes.
  snapshotBytes?: number;
  snapshotAt?: number;
  steer?: () => void;
}

const textOf = (content: readonly { type: string; text?: string }[]) =>
  content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");

// As talker.ts: first token is any streamed change, thinking too; first visible is text or a tool call.
const messageEvent = (turn: Turn, event: AgentEvent, at: number) => {
  if (event.type === "message_update") {
    turn.firstToken ??= at;
    const visible = event.changes.some(
      (change) =>
        change.type === "text_delta" ||
        change.type === "toolcall_start" ||
        ((change.type === "block" || change.type === "text_start") &&
          change.block.type !== "thinking")
    );
    if (visible) {
      turn.firstVisible ??= at;
    }
  } else if (
    event.type === "message_end" &&
    event.entry.kind === "pi.assistant"
  ) {
    const [message] = event.entry.model ?? [];
    if (message?.role === "assistant") {
      turn.firstToken ??= at;
      turn.firstVisible ??= at;
      const { usage } = message as AssistantMessage;
      turn.cost += usage.cost.total;
      turn.messages.push({
        at,
        cost: usage.cost.total,
        output: usage.output,
        run: turn.run,
      });
      turn.texts.push(textOf(message.content));
    }
  }
};

// A steer lands a second after the turn's build starts: the main agent's `build` call, or the one agent's first tool
// call.
const scheduleSteer = (turn: Turn) => {
  const { steer } = turn;
  if (steer) {
    turn.steer = undefined;
    setTimeout(steer, STEER_AFTER_MS);
  }
};

const toolEvent = (turn: Turn, event: AgentEvent, at: number) => {
  if (event.type === "tool_execution_start") {
    turn.tools.set(event.toolCallId, {
      args: event.args as Record<string, unknown>,
      callId: event.toolCallId,
      name: event.toolName,
      run: turn.run,
      startedAt: at,
    });
    if (event.toolName !== "build" || "brief" in event.args) {
      scheduleSteer(turn);
    }
  }
  // The main agent's `build` has a brief; the one agent's publishes the workspace and has none.
  if (
    event.type === "tool_execution_start" &&
    event.toolName === "build" &&
    "brief" in event.args
  ) {
    turn.builds.set(event.toolCallId, {
      callId: event.toolCallId,
      labelAt: [],
      labels: [],
      spec: event.args as unknown as Spec,
      startedAt: at,
    });
  } else if (event.type === "tool_execution_update" && event.output) {
    // The Coder's `step` labels, a line each: one per tool call, which is how the in-process runs counted steps.
    const build = turn.builds.get(event.toolCallId);
    const { output } = event;
    if (build) {
      const set = "set" in output;
      const lines = (set ? output.set : (output.append ?? ""))
        .split("\n")
        .filter(Boolean);
      build.labels = set ? lines : [...build.labels, ...lines];
      build.labelAt = [
        ...build.labelAt.slice(0, build.labels.length),
        ...Array.from(
          { length: Math.max(0, build.labels.length - build.labelAt.length) },
          () => at
        ),
      ];
    }
  } else if (event.type === "tool_execution_end") {
    const tool = turn.tools.get(event.toolCallId);
    if (tool) {
      tool.endedAt = at;
      tool.result = event.entry?.model?.[0] as ToolResultMessage | undefined;
    }
    const build = turn.builds.get(event.toolCallId);
    if (build) {
      build.endedAt = at;
      build.result = event.entry?.model?.[0] as ToolResultMessage | undefined;
    }
  }
};

// A message's outcome. Its route answered with pi's operation id, which is the submission's requestId.
const submissionEvent = (turn: Turn, event: AgentEvent) => {
  if (event.type !== "submission" || !event.record.requestId) {
    return;
  }
  const { record } = event;
  if (record.status === "done") {
    turn.answered.set(record.requestId ?? "", undefined);
  } else if (record.status === "unanswered") {
    turn.answered.set(record.requestId ?? "", record.reason);
  }
};

// Tools that work on the game: a run with any of them and no `build` is a build that never published.
const WORKING = new Set(["bash", "edit", "playtest", "write"]);

// The one agent's builds: one per run that called `build`, or worked on the game, from the run's first tool call but
// `build` to its last `build`'s end. Its labels are the step labels of each tool call, plus a "Harness failed:" one per
// failed `build`, as the sub agent's ending reported them; its spec is the last successful `build`'s arguments, with
// the Creator's messages as its brief; its result is that `build`'s, or the last failed one's.
const singleBuilds = (turn: Turn): Build[] =>
  [...Map.groupBy(turn.tools.values(), (tool) => tool.run).values()].flatMap(
    (tools) => {
      const publishes = tools.filter((tool) => tool.name === "build");
      if (
        publishes.length === 0 &&
        !tools.some((tool) => WORKING.has(tool.name))
      ) {
        return [];
      }
      const last = publishes.at(-1);
      const ok = publishes.findLast(
        (tool) => tool.result && !tool.result.isError
      );
      const chosen = ok ?? last;
      const endedAt =
        last?.endedAt ??
        Math.max(...tools.map((tool) => tool.endedAt ?? tool.startedAt));
      const startedAt =
        (tools.find((tool) => tool.name !== "build") ?? tools[0])?.startedAt ??
        endedAt;
      const steps = tools
        .filter((tool) => tool.startedAt <= endedAt)
        .flatMap((tool) => {
          if (tool.name !== "build") {
            return [
              { at: tool.startedAt, label: stepLabel(tool.name, tool.args) },
            ];
          }
          const text = textOf(tool.result?.content ?? []);
          const threw =
            /These checks threw and were skipped[^:]*: (?<errors>.*)/u.exec(
              text
            )?.groups?.errors;
          return [
            ...(threw
              ? [
                  {
                    at: tool.endedAt ?? tool.startedAt,
                    label: `Test error: ${threw}`,
                  },
                ]
              : []),
            ...(tool.result?.isError
              ? [
                  {
                    at: tool.endedAt ?? tool.startedAt,
                    label: `Harness failed: ${text.replaceAll("\n", " ").slice(0, 600)}`,
                  },
                ]
              : []),
          ];
        });
      const args = (chosen?.args ?? {}) as {
        title?: string;
        description?: string;
        kind?: "new" | "change";
        music?: boolean;
      };
      const messages = turn.messages.filter(
        (message) => message.run === tools[0]?.run && message.at <= endedAt
      );
      return [
        {
          callId: chosen?.callId ?? tools[0]?.callId ?? "none",
          cost: messages.reduce((sum, message) => sum + message.cost, 0),
          endedAt,
          labelAt: steps.map((step) => step.at),
          labels: steps.map((step) => step.label),
          outputTokens: messages.reduce(
            (sum, message) => sum + message.output,
            0
          ),
          result:
            chosen?.result ??
            ({
              content: [{ text: "never published", type: "text" }],
              isError: true,
              role: "toolResult",
              timestamp: endedAt,
              toolCallId: "none",
              toolName: "build",
            } as unknown as ToolResultMessage),
          spec: {
            ...args,
            // No brief exists, so the judge grades against the Creator's own words.
            brief: `The Creator's messages so far, the last one is this build's:\n${turn.asked.join("\n")}`,
            music: args.music ? "yes" : null,
            title: args.title ?? "",
          },
          startedAt,
        },
      ];
    }
  );

// A build's dollars and output tokens: the single agent's from the Draft's own transcript; the sub agent's later, from
// the gateway (gateway.ts), by the tag the Worker gives its model calls.
const buildUsage = (build: Build, draftId: string | undefined) =>
  build.cost === undefined
    ? {
        cost: UNKNOWN,
        gatewayJob: draftId ? `${draftId}-${build.callId}` : undefined,
        outputTokens: UNKNOWN,
      }
    : {
        cost: build.cost,
        gatewayJob: undefined,
        outputTokens: build.outputTokens ?? UNKNOWN,
      };

// The build's report, or why it failed: the Coder's reason, or the build tool's own (busy, the Allowance used up, Stop).
const outcome = (build: Build) => {
  const text = textOf(build.result?.content ?? []);
  const failed = !build.result || build.result.isError;
  return {
    failed,
    reason: failed ? text.replace(BUILD_FAILED, "") || "no result" : undefined,
    text,
  };
};

type Frame =
  | { type: "snapshot"; data: { run?: unknown; inbox: unknown[] } }
  | { type: "batch"; data: AgentEvent[] }
  | { type: "tick" | "turn_done" | "turn_failed" };

export const runPreviewE2E = async ({
  base,
  token,
  chat,
  run,
  dir,
}: {
  base: string;
  token: () => Promise<string>;
  chat: Chat;
  run: number;
  dir: string;
}) => {
  mkdirSync(dir, { recursive: true });
  // A 503 is Screening without a verdict, refused before anything is stored; like the app, try it again.
  const api = async (
    route: string,
    method = "GET",
    body?: unknown,
    attempt = 1
  ): Promise<{ json: Record<string, unknown>; ok: boolean }> => {
    const response = await fetch(new URL(route, base), {
      headers: {
        Authorization: `Bearer ${await token()}`,
        "Content-Type": "application/json",
      },
      method,
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const json = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (response.status === 503 && attempt < RETRIES) {
      await sleep(RECONNECT_MS * attempt);
      return await api(route, method, body, attempt + 1);
    }
    if (response.status >= 500 || response.status === 401) {
      throw new Error(
        `${method} ${route}: ${response.status} ${JSON.stringify(json)}`
      );
    }
    return { json, ok: response.ok };
  };

  // The socket's view of the Draft, as the app keeps it, and the turn in flight.
  const view = { inbox: 0, running: false };
  let draftId: string | undefined;
  let socket: WebSocket | undefined;
  let turn: Turn | undefined;

  const onFrame = (frame: Frame, bytes: number) => {
    const at = Date.now();
    if (frame.type === "snapshot") {
      view.running = Boolean(frame.data.run);
      view.inbox = frame.data.inbox.length;
      if (turn) {
        turn.snapshotAt = at;
        turn.snapshotBytes = Math.max(turn.snapshotBytes ?? 0, bytes);
      }
    }
    if (frame.type !== "batch") {
      return;
    }
    for (const event of frame.data) {
      if (event.type === "run_start" || event.type === "run_end") {
        view.running = event.type === "run_start";
        if (turn && event.type === "run_start") {
          turn.run += 1;
        }
      } else if (event.type === "inbox_update") {
        view.inbox = event.items.length;
      }
      if (turn) {
        submissionEvent(turn, event);
        messageEvent(turn, event, at);
        toolEvent(turn, event, at);
      }
    }
  };

  // The app's socket (#126): a one-time ticket, "ping" every 20 s, and a new socket when one drops.
  const connect = async (id: string) => {
    const { json } = await api(`/api/drafts/${id}/ws-ticket`, "POST", {});
    const url = new URL(`/api/drafts/${id}/ws`, base);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("ticket", String(json.ticket));
    const ws = new WebSocket(url);
    socket = ws;
    const ping = setInterval(() => ws.send("ping"), PING_MS);
    ws.addEventListener("message", ({ data }) => {
      if (data !== "pong") {
        const text = String(data);
        onFrame(JSON.parse(text) as Frame, Buffer.byteLength(text));
      }
    });
    const reconnect = async ({ code, reason }: CloseEvent) => {
      clearInterval(ping);
      if (socket === ws && draftId) {
        console.warn(
          `${chat.id}: the socket closed (${code} ${reason}) ${turn ? `${Date.now() - turn.sentAt} ms into a turn` : "between turns"}; reconnecting`
        );
        await sleep(RECONNECT_MS);
        await connect(id);
      }
    };
    ws.addEventListener("close", reconnect);
    // An EventTarget's error doesn't reject `once`: a socket that never opens times out instead.
    await once(ws, "open", { signal: AbortSignal.timeout(OPEN_MS) });
  };

  // A message: the first one makes the Draft, later ones go to it (joining a running turn as a steer). A message
  // Screening refuses never reaches the Talker.
  const send = async (
    text: string
  ): Promise<{ id: string } | { refused: string }> => {
    const { json, ok } = draftId
      ? await api(`/api/drafts/${draftId}/messages`, "POST", { text })
      : await api("/api/drafts", "POST", { text });
    if (!ok) {
      return { refused: String(json.error) };
    }
    if (turn) {
      turn.acceptedAt = Date.now();
    }
    if (!draftId) {
      draftId = String(json.id);
      await connect(draftId);
    }
    return { id: String(json.message ?? json.id) };
  };

  // Settled: no run, nothing queued, and every message sent this turn answered. A snapshot taken after the Worker
  // accepted them (the first message's Draft is made before its socket opens) stands in for outcomes the socket didn't
  // see. One taken while a message was still in flight, by a socket that reconnected then, shows neither it nor its run.
  const settled = async (current: Turn) => {
    const deadline = Date.now() + TURN_MS;
    const done = () =>
      !view.running &&
      view.inbox === 0 &&
      (current.sent.every((id) => current.answered.has(id)) ||
        (current.snapshotAt ?? 0) > (current.acceptedAt ?? Infinity));
    while (!done()) {
      if (Date.now() > deadline) {
        throw new Error(
          `${chat.id}: the turn didn't end in ${TURN_MS / 1000} s`
        );
      }
      // oxlint-disable-next-line no-await-in-loop -- polling the socket's view
      await sleep(POLL_MS);
    }
  };

  // The current Revision, through the app's preview link: index.html's siblings, as the WebView loads them.
  const readRevision = async (id: string) => {
    const { json } = await api(`/api/drafts/${id}/preview`);
    const link = String(json.url);
    const files = await Promise.all(
      REVISION_FILES.map(async (file) => {
        const response = await fetch(link.replace(/index\.html$/u, file));
        return [file, response.ok ? await response.text() : undefined] as const;
      })
    );
    return Object.fromEntries(
      files.flatMap(([file, text]) =>
        text === undefined ? [] : [[file, text]]
      )
    ) as Record<string, string>;
  };

  const draft = { n: 0, source: {} as Record<string, string> };
  const coderRecord = async (build: Build, index: number) => {
    const buildDir = path.join(dir, `build-${index}`);
    mkdirSync(buildDir, { recursive: true });
    // A start over on a Draft with a Revision is a new game, judged as one: by its `kind`, not by the Draft.
    const edit =
      build.spec.kind === undefined
        ? draft.n > 0
        : build.spec.kind === "change";
    const kind: CoderJob["kind"] = edit ? "edit" : "build";
    const { failed, reason, text } = outcome(build);
    const files = failed || !draftId ? {} : await readRevision(draftId);
    for (const [file, contents] of Object.entries(files)) {
      writeFileSync(path.join(buildDir, file), contents);
    }
    if (files["game.js"]) {
      writeFileSync(path.join(buildDir, "preview.html"), previewHtml(files));
    }
    const checked = failed ? undefined : await finalChecks(buildDir, files);
    const final = checked?.final;
    const finalGreen = final?.random.ok === true;
    // The judge reads the game, not music.js's base64.
    const { [MUSIC]: _music, ...judged } = files;
    const scores = checked
      ? await judgeCoder({
          end: checked.end,
          files: judged,
          original: edit ? draft.source : undefined,
          signals: checked.final.random,
          spec: build.spec,
          start: checked.start,
        }).catch((error: unknown) => ({ error: String(error) }))
      : undefined;
    const record = {
      ...buildUsage(build, draftId),
      agent: "coder",
      errors: [],
      events: build.labels,
      final,
      finalGreen,
      firstGreen: UNKNOWN,
      imagesSent: UNKNOWN,
      job: `${chat.id}-${index}`,
      judge: scores,
      kind,
      model: "preview",
      music: Boolean(build.spec.music),
      pass: passes(kind, finalGreen, scores),
      playtests: build.labels.filter((label) => label === "Playtesting").length,
      reason,
      run,
      // From the `build` call's start to its result: the job, plus reading and writing R2.
      seconds: ((build.endedAt ?? Date.now()) - build.startedAt) / 1000,
      // Seconds from the build's start to each label, in step order.
      stepSeconds: build.labelAt.map((at) => (at - build.startedAt) / 1000),
      steps: build.labels.length,
      summary: failed ? undefined : text,
      thinking: "preview",
      toolCalls: UNKNOWN,
      turns: UNKNOWN,
      usage: UNKNOWN,
      warnings: warningsOf([final?.random]),
    };
    writeFileSync(
      path.join(buildDir, "result.json"),
      JSON.stringify(record, null, 2)
    );
    if (!failed) {
      draft.n += 1;
      draft.source = Object.fromEntries(
        Object.entries(files).filter(([file]) => SOURCE_FILES.includes(file))
      );
    }
    return record;
  };

  let asked: string[] = [];
  // Whether a sub agent built any of the chat's games (ADR 0005), rather than the one agent (ADR 0006).
  let subAgent = false;
  const playTurn = async (script: Chat["turns"][number]) => {
    const current: Turn = {
      answered: new Map(),
      asked: [...asked, script.text],
      builds: new Map(),
      cost: 0,
      messages: [],
      run: 0,
      sent: [],
      sentAt: Date.now(),
      texts: [],
      tools: new Map(),
    };
    const { steer } = script;
    if (steer) {
      current.steer = async () => {
        current.steer = undefined;
        const sent = await send(steer);
        current.asked.push(steer);
        if ("id" in sent) {
          current.sent.push(sent.id);
        }
      };
    }
    turn = current;
    const sent = await send(script.text);
    if ("id" in sent) {
      current.sent.push(sent.id);
      await settled(current);
    }
    turn = undefined;
    ({ asked } = current);
    subAgent ||= current.builds.size > 0;
    const built =
      current.builds.size > 0
        ? [...current.builds.values()]
        : singleBuilds(current);
    const failed = [...current.answered.values()].find(Boolean);
    const since = (at: number | undefined) =>
      at === undefined ? undefined : at - current.sentAt;
    return {
      built,
      record: {
        ...turnRecord({
          buildMs: built.reduce(
            (sum, build) =>
              sum + (build.endedAt ?? Date.now()) - build.startedAt,
            0
          ),
          builds: built.map((build) => build.spec),
          // The single agent's builds are in the turn's transcript: their cost is the build's, not the reply's.
          cost:
            current.cost -
            built.reduce((sum, build) => sum + (build.cost ?? 0), 0),
          firstTokenMs: since(current.firstToken),
          firstVisibleMs: since(current.firstVisible),
          ms: Date.now() - current.sentAt,
          // Screening's refusal is the reply the Creator sees, and nothing is built: what the off-limits chat asks.
          reply:
            "refused" in sent ? sent.refused : current.texts.join("\n").trim(),
          status: failed === undefined ? "done" : "unanswered",
          turn: script,
          unanswered: failed,
        }),
        // The largest snapshot frame of the turn (on connect and reconnect), in bytes; null when none came.
        snapshotBytes: current.snapshotBytes ?? UNKNOWN,
      },
    };
  };

  // A Delete that fails partway finishes on a retry. One that keeps failing leaves the Draft behind but keeps the
  // chat's results.
  const deleteDraft = async (id: string, attempt = 1): Promise<void> => {
    try {
      await api(`/api/drafts/${id}`, "DELETE");
    } catch (error) {
      console.warn(
        `Couldn't delete Draft ${id} (try ${attempt}): ${String(error)}`
      );
      if (attempt < RETRIES) {
        await sleep(RECONNECT_MS * attempt);
        await deleteDraft(id, attempt + 1);
      }
    }
  };

  const builds: Awaited<ReturnType<typeof coderRecord>>[] = [];
  const turns: ReturnType<typeof turnRecord>[] = [];
  try {
    for (const script of chat.turns) {
      // oxlint-disable-next-line no-await-in-loop -- a chat's turns are sequential
      const { built, record } = await playTurn(script);
      turns.push(record);
      for (const build of built) {
        // oxlint-disable-next-line no-await-in-loop -- each build reads its Revision before the next turn replaces it
        builds.push(await coderRecord(build, builds.length + 1));
      }
    }
  } finally {
    const id = draftId;
    draftId = undefined;
    socket?.close();
    if (id) {
      await deleteDraft(id);
    }
  }
  const talker = await judgeChat({
    agents: subAgent ? 2 : 1,
    chat,
    dir,
    modelId: "preview",
    run,
    thinking: "preview",
    turns,
  });
  return { builds, talker };
};
