import type { BoxEdge, Exec } from "../../src/coder-box.ts";
// The Worker for test/coder.test.js: the real Coder (src/coder.ts) with its two edges faked.
// - The model: every model call ends at globalThis.fetch, which answers Cloudflare's /ai/v1/messages here, as a
//   scripted Anthropic stream. The job's brief names the script (SCRIPTS); each reply is the script's next step, by
//   how many answers the conversation already holds. A script can be a function, for a model that never stops.
// - The box: files in the Coder's own storage (so they outlive a restart, as a running box does), every command logged
//   and answered by fakeExec: the playtest always green, music.mjs rendering a fixed track, the rest a no-op. A Draft
//   whose id starts with "nobox" gets a box that can't start.
// /__coder/<draftId>/fake/log returns the box's commands, and its start, destroy and inactivity timeout; /fake/release
// lets a held model step ("hold") answer.
import { DraftCoder as Coder } from "../../src/coder.ts";

export { default } from "../../src/index.ts";

interface Block {
  type: string;
  text?: string;
}
interface Message {
  role: string;
  content: string | Block[];
}
type Step =
  | { tool: string; input: object }
  | { text: string }
  // Waits for /fake/release, then answers `text`.
  | { hold: true; text: string }
  // Answers `text` after this many ms: time to kill the server mid-job.
  | { sleep: number; text: string };

const GAME = "let speed = 1;\nfunction gameRender() {}\n";
const SCRIPTS: Record<string, Step[] | ((turn: number) => Step)> = {
  change: [
    { input: { path: "game.ts" }, tool: "read" },
    {
      input: {
        edits: [{ newText: "speed = 2", oldText: "speed = 1" }],
        path: "game.ts",
      },
      tool: "edit",
    },
    { input: {}, tool: "playtest" },
    { text: "Made it faster." },
  ],
  // Writes forever: the step limit's case.
  loop: () => ({ input: { content: GAME, path: "game.ts" }, tool: "write" }),
  new: [
    { input: { content: GAME, path: "game.ts" }, tool: "write" },
    { input: {}, tool: "playtest" },
    { text: "Built Star Catcher." },
  ],
  slow: [
    { input: { content: GAME, path: "game.ts" }, tool: "write" },
    { input: {}, tool: "playtest" },
    { sleep: 2000, text: "Built it after a restart." },
  ],
  wait: [
    { input: { content: GAME, path: "game.ts" }, tool: "write" },
    { input: {}, tool: "playtest" },
    { hold: true, text: "Built it after a wait." },
  ],
};

const sse = (events: object[]) =>
  new Response(
    events
      .map(
        (event) =>
          `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`
      )
      .join(""),
    { headers: { "content-type": "text/event-stream" } }
  );

const reply = (block: object, delta: object, stop: string) =>
  sse([
    {
      message: {
        content: [],
        id: `msg_${crypto.randomUUID()}`,
        model: "claude-haiku-5-5",
        role: "assistant",
        stop_reason: null,
        type: "message",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      type: "message_start",
    },
    { content_block: block, index: 0, type: "content_block_start" },
    { delta, index: 0, type: "content_block_delta" },
    { index: 0, type: "content_block_stop" },
    {
      delta: { stop_reason: stop, stop_sequence: null },
      type: "message_delta",
      usage: { output_tokens: 1 },
    },
    { type: "message_stop" },
  ]);

// One held step per Draft, released by /fake/release whether the step is reached before or after.
const gates = new Map<string, PromiseWithResolvers<undefined>>();
const gate = (draftId: string) => {
  const found = gates.get(draftId) ?? Promise.withResolvers<undefined>();
  gates.set(draftId, found);
  return found;
};

const model = async (request: Request) => {
  const { draftId } = JSON.parse(
    request.headers.get("cf-aig-metadata") ?? "{}"
  ) as { draftId: string };
  const { messages } = await request.json<{ messages: Message[] }>();
  const brief = /Brief: (?<name>\w+)/u.exec(JSON.stringify(messages[0]))?.groups
    ?.name;
  const script = SCRIPTS[brief ?? ""];
  if (!script) {
    return new Response(`no script for the brief ${brief}`, { status: 400 });
  }
  const turn = messages.filter((m) => m.role === "assistant").length;
  const step =
    typeof script === "function"
      ? script(turn)
      : (script[turn] ?? { text: "Out of script." });
  if ("tool" in step) {
    return reply(
      {
        id: `toolu_${crypto.randomUUID().replaceAll("-", "")}`,
        input: {},
        name: step.tool,
        type: "tool_use",
      },
      { partial_json: JSON.stringify(step.input), type: "input_json_delta" },
      "tool_use"
    );
  }
  if ("hold" in step) {
    await gate(draftId).promise;
  }
  if ("sleep" in step) {
    await scheduler.wait(step.sleep);
  }
  return reply(
    { text: "", type: "text" },
    { text: step.text, type: "text_delta" },
    "end_turn"
  );
};

const upstream = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const request = new Request(input, init);
  return new URL(request.url).pathname.endsWith("/ai/v1/messages")
    ? model(request)
    : upstream(request);
};

const encode = (text: string) => new TextEncoder().encode(text);
const PLAYTEST = JSON.stringify({ errors: [], ok: true, typeErrors: [] });
// A PNG's first bytes are enough for a screenshot nobody looks at.
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const OPUS = new Uint8Array([79, 103, 103, 83]);

// The box's files and running flag live under this prefix in the Coder's storage.
const key = (path: string) => `fakebox:${path}`;
const ok = (stdout = ""): Exec => ({
  exitCode: 0,
  stderr: "",
  stdout: encode(stdout),
});

const fileError = (code: string, operation: string, path: string) =>
  Object.assign(new Error(`${operation} ${path}: ${code}`), {
    code,
    detail: code,
    name: "SandboxFileError",
    operation,
    path,
  });

export class DraftCoder extends Coder {
  override boxEdge(): BoxEdge {
    const { kv } = this.ctx.storage;
    const paths = () =>
      [...kv.list<Uint8Array>({ prefix: "fakebox:/" })].map(([k]) =>
        k.slice("fakebox:".length)
      );
    const put = (path: string, bytes: Uint8Array) => kv.put(key(path), bytes);
    const get = (path: string, operation: string) => {
      const bytes = kv.get<Uint8Array>(key(path));
      if (!bytes) {
        throw fileError("ENOENT", operation, path);
      }
      return bytes;
    };
    const isDir = (path: string) =>
      path === "/workspace" || paths().some((p) => p.startsWith(`${path}/`));
    const stat = (path: string, operation: string) => {
      const type = isDir(path) ? "directory" : "file";
      const size = type === "file" ? get(path, operation).length : 0;
      return Promise.resolve({
        accessedAt: new Date(0),
        changedAt: new Date(0),
        gid: 1001,
        mode: 0o644,
        modifiedAt: new Date(0),
        size: BigInt(size),
        type,
        uid: 1001,
      } as const);
    };
    const log = (command: string) =>
      kv.put("fakelog", [...(kv.get<string[]>("fakelog") ?? []), command]);
    const fakeExec = (command: string): Exec => {
      if (command.includes("find /workspace -mindepth 1 -delete")) {
        for (const path of paths()) {
          kv.delete(key(path));
        }
      } else if (command.includes("/opt/hopon/playtest.js")) {
        put("/workspace/game.js", encode("// built"));
        put("/workspace/playtest-start.png", PNG);
        put("/workspace/playtest-end.png", PNG);
        return ok(`${PLAYTEST}\n`);
      } else if (command.includes("node music.mjs")) {
        put("/workspace/music.opus", OPUS);
        return ok("30.0\n");
      }
      return ok();
    };
    const box: BoxEdge = {
      destroy: () => {
        log("destroy");
        kv.delete("fakebox:running");
        return Promise.resolve();
      },
      exec: (argv) => {
        const command = argv.join(" ");
        log(command);
        return Promise.resolve(fakeExec(command));
      },
      files: {
        lstat: (path) => stat(path, "lstat"),
        mkdir: () => Promise.resolve(),
        readDirectory: (path) => {
          const names = new Set(
            paths()
              .filter((p) => p.startsWith(`${path}/`))
              .map((p) => p.slice(path.length + 1).split("/")[0] ?? "")
          );
          return Promise.resolve(
            [...names].map((name) => ({
              name,
              type: isDir(`${path}/${name}`) ? "directory" : "file",
            }))
          );
        },
        readFile: (path) =>
          Promise.resolve(new Response(get(path, "readFile"))),
        remove: (path) => {
          for (const p of paths()) {
            if (p === path || p.startsWith(`${path}/`)) {
              kv.delete(key(p));
            }
          }
          return Promise.resolve();
        },
        rename: (from, to) => {
          put(to, get(from, "rename"));
          kv.delete(key(from));
          return Promise.resolve();
        },
        stat: (path) => stat(path, "stat"),
        writeFile: async (path, content) => {
          put(path, new Uint8Array(await new Response(content).arrayBuffer()));
        },
      },
      get running() {
        return kv.get("fakebox:running") === true;
      },
      setInactivityTimeout: () => {
        log("inactivity timeout");
        return Promise.resolve();
      },
      start: () => {
        if (this.ctx.id.name?.startsWith("nobox")) {
          return Promise.reject(new Error("no box to start"));
        }
        log("start");
        kv.put("fakebox:running", true);
        return Promise.resolve();
      },
    };
    return box;
  }

  override async fetch(request: Request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/fake/log") {
      return Response.json(this.ctx.storage.kv.get("fakelog") ?? []);
    }
    if (pathname === "/fake/release") {
      gate(this.ctx.id.name ?? "").resolve();
      return new Response(null, { status: 204 });
    }
    return await super.fetch(request);
  }
}
