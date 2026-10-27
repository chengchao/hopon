// The end-to-end run against a deployed Worker Preview (#174): what ships, playtest timings on Cloudflare included. A
// Clerk Development user drives each scripted chat through the app's own Draft routes and WebSocket; each build's
// Revision is read back through its preview link, playtested here as the box does (the eval's final checks), judged,
// and recorded as the in-process run (e2e.ts) records it, so the same report reads both.
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
import type { PlaytestResult, Spec } from "../src/coder.ts";
import { passes, previewHtml, warningsOf } from "./coder.ts";
import type { CoderJob } from "./coder.ts";
import { judgeCoder } from "./judge.ts";
import { judgeChat, turnRecord } from "./talker.ts";
import type { Chat } from "./talker.ts";

// A Revision's files (talker-build.ts writes them to R2), and the ones a job carries.
const REVISION_FILES = ["index.html", "game.ts", "game.js", "music.mjs", MUSIC];
const SOURCE_FILES = ["game.ts", "index.html", "music.mjs"];
const PLAYTEST = path.join(import.meta.dirname, "..", "image", "playtest.js");
// What the Preview doesn't report. Not 0: a stat leaves these runs out (report.ts).
const UNKNOWN = null;
// As talker.ts: a steer lands a second into the build.
const STEER_AFTER_MS = 1000;
const PING_MS = 20_000;
const RECONNECT_MS = 1000;
const DELETE_TRIES = 3;
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

// The eval's final checks of a built game, in dir/box. The Preview doesn't report the Coder's last inputs, so the
// replay plays the default 3 s with none; then the fixed random script, whose screenshots are kept and judged.
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
  const replay = await playtest(box, JSON.stringify({ inputs: [] }));
  const random = await playtest(box, "random");
  const [start, end] = ["start", "end"].map((shot) => {
    const png = path.join(box, `playtest-${shot}.png`);
    if (existsSync(png)) {
      copyFileSync(png, path.join(dir, `${shot}.png`));
    }
    return existsSync(png) ? readFileSync(png).toString("base64") : undefined;
  });
  return { end, final: { random, replay }, start };
};

// One build as the Draft's socket showed it: the `build` call's spec, its step labels and its result.
interface Build {
  spec: Spec;
  startedAt: number;
  endedAt?: number;
  labels: string[];
  result?: ToolResultMessage;
}

// What the socket shows of the turn in flight.
interface Turn {
  sentAt: number;
  sent: string[];
  answered: Map<string, string | undefined>;
  texts: string[];
  cost: number;
  firstToken?: number;
  firstVisible?: number;
  builds: Map<string, Build>;
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
      turn.cost += (message as AssistantMessage).usage.cost.total;
      turn.texts.push(textOf(message.content));
    }
  }
};

const toolEvent = (turn: Turn, event: AgentEvent, at: number) => {
  if (event.type === "tool_execution_start" && event.toolName === "build") {
    turn.builds.set(event.toolCallId, {
      labels: [],
      spec: event.args as unknown as Spec,
      startedAt: at,
    });
    if (turn.steer) {
      setTimeout(turn.steer, STEER_AFTER_MS);
    }
  } else if (event.type === "tool_execution_update" && event.output) {
    // The Coder's `step` labels, a line each: one per tool call, which is how the in-process run counts steps.
    const build = turn.builds.get(event.toolCallId);
    const { output } = event;
    if (build) {
      const set = "set" in output;
      const lines = (set ? output.set : (output.append ?? ""))
        .split("\n")
        .filter(Boolean);
      build.labels = set ? lines : [...build.labels, ...lines];
    }
  } else if (event.type === "tool_execution_end") {
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

// The build's report, or why it failed: the Coder's reason, or the build tool's own (busy, the daily limit, Stop).
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
  const api = async (route: string, method = "GET", body?: unknown) => {
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

  const onFrame = (frame: Frame) => {
    const at = Date.now();
    if (frame.type === "snapshot") {
      view.running = Boolean(frame.data.run);
      view.inbox = frame.data.inbox.length;
      if (turn) {
        turn.snapshotAt = at;
      }
    }
    if (frame.type !== "batch") {
      return;
    }
    for (const event of frame.data) {
      if (event.type === "run_start" || event.type === "run_end") {
        view.running = event.type === "run_start";
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
        onFrame(JSON.parse(String(data)) as Frame);
      }
    });
    const reconnect = async () => {
      clearInterval(ping);
      if (socket === ws && draftId) {
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
    if (!draftId) {
      draftId = String(json.id);
      await connect(draftId);
    }
    return { id: String(json.message ?? json.id) };
  };

  // Settled: no run, nothing queued, and every message sent this turn answered. A snapshot taken after them (the
  // first message's Draft is made before its socket opens) stands in for outcomes the socket didn't see.
  const settled = async (current: Turn) => {
    const deadline = Date.now() + TURN_MS;
    const done = () =>
      !view.running &&
      view.inbox === 0 &&
      (current.sent.every((id) => current.answered.has(id)) ||
        (current.snapshotAt ?? 0) > current.sentAt);
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
    const kind: CoderJob["kind"] = draft.n > 0 ? "edit" : "build";
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
    const finalGreen = final?.replay.ok === true && final.random.ok;
    // The judge reads the game, not music.js's base64.
    const { [MUSIC]: _music, ...judged } = files;
    const scores = checked
      ? await judgeCoder({
          end: checked.end,
          files: judged,
          original: draft.n > 0 ? draft.source : undefined,
          signals: checked.final.random,
          spec: build.spec,
          start: checked.start,
        }).catch((error: unknown) => ({ error: String(error) }))
      : undefined;
    const record = {
      agent: "coder",
      cost: UNKNOWN,
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
      steps: build.labels.length,
      summary: failed ? undefined : text,
      thinking: "preview",
      toolCalls: UNKNOWN,
      turns: UNKNOWN,
      usage: UNKNOWN,
      warnings: warningsOf([final?.random, final?.replay]),
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

  const playTurn = async (script: Chat["turns"][number]) => {
    const current: Turn = {
      answered: new Map(),
      builds: new Map(),
      cost: 0,
      sent: [],
      sentAt: Date.now(),
      texts: [],
    };
    const { steer } = script;
    if (steer) {
      current.steer = async () => {
        current.steer = undefined;
        const sent = await send(steer);
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
    const built = [...current.builds.values()];
    const failed = [...current.answered.values()].find(Boolean);
    const since = (at: number | undefined) =>
      at === undefined ? undefined : at - current.sentAt;
    return {
      built,
      record: turnRecord({
        buildMs: built.reduce(
          (sum, build) => sum + (build.endedAt ?? Date.now()) - build.startedAt,
          0
        ),
        builds: built.map((build) => build.spec),
        cost: current.cost,
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
      if (attempt < DELETE_TRIES) {
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
    chat,
    dir,
    modelId: "preview",
    run,
    thinking: "preview",
    turns,
  });
  return { builds, talker };
};
