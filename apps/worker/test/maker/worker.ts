// The Worker for test/maker.test.js: the real API and Maker (src/maker.ts), with the model and the sandbox faked.
// - The model: every model call ends at globalThis.fetch, which answers Cloudflare's /ai/v1/messages here, as a
//   scripted Anthropic stream. The gateway tag says which agent calls.
//   - The main agent: a message "build <script>" calls `build` with the script's name as the brief (with music when the
//     name says so); "build twice" builds `new`, then asks for a second build in the same turn. Anything else gets a
//     text reply that repeats what the model was last sent, a tool's result included. Each call reads 1,000 input
//     tokens, 1,000 hopon tokens at Haiku 5.5's $0.10 a million, or n after "spend <n>"; "no credits" gets the
//     gateway's 402.
//   - The sub agent: the brief names the script (SCRIPTS); each reply is the script's next step, by how many answers
//     the conversation holds. Each call reads 1 input and writes 1 output token, 6 hopon tokens.
// - The sandbox: files in the Maker's own storage (so they outlive a restart, as a running box does), every command
//   logged and answered by fakeExec: the playtest green unless game.ts says BROKEN, music.mjs rendering a fixed track,
//   the rest a no-op. As the platform's, a stopped box refuses every command and file, and one started again is empty.
// - The deadline: the "late" scripts' is 1 s, so their case is quick; the reason still names the job's real deadline.
// /__maker/<draftId>/fake/<what> (MAKER_DEV's route) reaches the Draft's Maker: `log` returns the box's commands, and
// its start, destroy and inactivity timeout; `release` lets a held step answer; `nobox` stops the box and makes its
// next start fail; `lose` makes the box stop with the server, as a box on another host would; `calls` counts the sub agent's model
// calls; `destroyed` says whether the Draft's box was destroyed.
import { Effect, Layer } from "effect";

import { AgentSandbox, NoBox } from "../../src/agent-sandbox.ts";
import type { Exec } from "../../src/agent-sandbox.ts";
import { Maker as RealMaker } from "../../src/maker.ts";

export { default, DraftCoder, Talker } from "../../src/index.ts";

interface Block {
  type: string;
  text?: string;
  content?: string | Block[];
}
interface Message {
  role: string;
  content: string | Block[];
}
type Step =
  | { tool: string; input: object }
  | { text: string }
  // Waits for `release`, then answers `text`.
  | { hold: true; text: string }
  // Answers `text` after this many ms: time to kill the server mid-job.
  | { sleep: number; text: string };

const GAME = "let speed = 1;\nfunction gameRender() {}\n";
const write = { input: { content: GAME, path: "game.ts" }, tool: "write" };
const play = { input: {}, tool: "playtest" };
const edit = (to: string) => ({
  input: { edits: [{ newText: to, oldText: "speed = 1" }], path: "game.ts" },
  tool: "edit",
});
const late = [{ hold: true, text: "Too late." }] as const;
const SCRIPTS: Record<string, readonly Step[] | ((turn: number) => Step)> = {
  // Breaks the game after a green playtest: the ending must fail it.
  breakLate: [write, play, edit("BROKEN"), { text: "Tidied it." }],
  change: [
    { input: { path: "game.ts" }, tool: "read" },
    edit("speed = 2"),
    play,
    { text: "Made it faster." },
  ],
  // Changes the game after a green playtest and stops: the ending must play what it ships.
  editLate: [write, play, edit("speed = 3"), { text: "Made it faster." }],
  // Runs a command until it's stopped.
  hang: [{ input: { command: "sleep 600" }, tool: "bash" }],
  // Never answers: the deadline's case.
  late,
  lateMusic: late,
  // Writes forever: the step limit's case.
  loop: () => write,
  music: [
    write,
    { input: { content: "// a track", path: "music.mjs" }, tool: "write" },
    { input: { command: "node music.mjs" }, tool: "bash" },
    play,
    { text: "Built it with music." },
  ],
  new: [write, play, { text: "Built Moon Cat." }],
  slow: [write, play, { sleep: 2000, text: "Built it after a restart." }],
  wait: [write, play, { hold: true, text: "Built it after a wait." }],
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

const reply = (
  block: object,
  delta: object,
  stop: string,
  usage: { input: number; output: number }
) =>
  sse([
    {
      message: {
        content: [],
        id: `msg_${crypto.randomUUID()}`,
        model: "claude-haiku-5-5",
        role: "assistant",
        stop_reason: null,
        type: "message",
        usage: { input_tokens: usage.input, output_tokens: 0 },
      },
      type: "message_start",
    },
    { content_block: block, index: 0, type: "content_block_start" },
    { delta, index: 0, type: "content_block_delta" },
    { index: 0, type: "content_block_stop" },
    {
      delta: { stop_reason: stop, stop_sequence: null },
      type: "message_delta",
      usage: { output_tokens: usage.output },
    },
    { type: "message_stop" },
  ]);

const toolCall = (
  name: string,
  input: object,
  usage: { input: number; output: number }
) =>
  reply(
    {
      id: `toolu_${crypto.randomUUID().replaceAll("-", "")}`,
      input: {},
      name,
      type: "tool_use",
    },
    { partial_json: JSON.stringify(input), type: "input_json_delta" },
    "tool_use",
    usage
  );
const say = (text: string, usage: { input: number; output: number }) =>
  reply(
    { text: "", type: "text" },
    { text, type: "text_delta" },
    "end_turn",
    usage
  );

const texts = (content: string | Block[] | undefined): string[] => {
  if (typeof content === "string") {
    return [content];
  }
  return (content ?? []).flatMap((block) =>
    block.type === "tool_result" ? texts(block.content) : [block.text ?? ""]
  );
};

// One held step per Draft, released by `release` whether the step is reached before or after.
const gates = new Map<string, PromiseWithResolvers<undefined>>();
const gate = (draftId: string) => {
  const found = gates.get(draftId) ?? Promise.withResolvers<undefined>();
  gates.set(draftId, found);
  return found;
};
const subCalls = new Map<string, number>();
// The Drafts whose box was destroyed, outside the Maker's storage, which a Delete removes.
const destroyed = new Set<string>();

const MAIN = { input: 1000, output: 0 };
const SUB = { input: 1, output: 1 };

const main = (messages: Message[]) => {
  const said = texts(messages.at(-1)?.content);
  if (said.includes("no credits")) {
    return Response.json(
      {
        error: "Insufficient unified billing balance; available balance $0.00",
      },
      { status: 402 }
    );
  }
  // "build twice" asks for a second build once the first has answered, as a model could in one turn.
  const asked = messages.findLastIndex(
    ({ content, role }) =>
      role === "user" &&
      (typeof content === "string" ||
        content.every((block) => block.type !== "tool_result"))
  );
  const twice = texts(messages[asked]?.content).includes("build twice");
  const builds = messages
    .slice(asked)
    .filter(({ role }) => role === "assistant").length;
  const script =
    twice && builds < 2
      ? "new"
      : said.find((text) => text.startsWith("build "))?.slice(6);
  if (script === undefined) {
    const spend = said.find((text) => text.startsWith("spend "))?.slice(6);
    return say(`said: ${said.join(" | ")}`, {
      ...MAIN,
      input: spend === undefined ? MAIN.input : Number(spend),
    });
  }
  return toolCall(
    "build",
    {
      brief: script,
      description: "Tap to jump from moon to moon.",
      music: /music/iu.test(script) ? "chiptune" : null,
      title: "Moon Cat",
    },
    MAIN
  );
};

const sub = async (request: Request, draftId: string, messages: Message[]) => {
  subCalls.set(draftId, (subCalls.get(draftId) ?? 0) + 1);
  const name = /Brief: (?<name>\w+)/u.exec(JSON.stringify(messages[0]))?.groups
    ?.name;
  const script = SCRIPTS[name ?? ""];
  if (!script) {
    return new Response(`no script for the brief ${name}`, { status: 400 });
  }
  const turn = messages.filter((m) => m.role === "assistant").length;
  const step =
    typeof script === "function"
      ? script(turn)
      : (script[turn] ?? { text: "Out of script." });
  if ("tool" in step) {
    return toolCall(step.tool, step.input, SUB);
  }
  if ("hold" in step) {
    // An aborted run's model call ends, as a real one does.
    const aborted = Promise.withResolvers<undefined>();
    request.signal.addEventListener("abort", () =>
      aborted.reject(request.signal.reason)
    );
    await Promise.race([gate(draftId).promise, aborted.promise]);
    gates.delete(draftId);
  }
  if ("sleep" in step) {
    await scheduler.wait(step.sleep);
  }
  return say(step.text, SUB);
};

const model = async (request: Request) => {
  const { agent, draftId } = JSON.parse(
    request.headers.get("cf-aig-metadata") ?? "{}"
  ) as { agent: string; draftId: string };
  const { messages } = await request.json<{ messages: Message[] }>();
  return agent === "coder"
    ? await sub(request, draftId, messages)
    : main(messages);
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
const RED = JSON.stringify({ errors: ["boom"], ok: false, typeErrors: [] });
// A PNG's first bytes are enough for a screenshot nobody looks at.
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const OPUS = new Uint8Array([79, 103, 103, 83]);

// The box's files and running flag live under this prefix in the Maker's storage.
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

export class Maker extends RealMaker {
  override sandboxLayer() {
    const { kv } = this.ctx.storage;
    const paths = () =>
      [...kv.list<Uint8Array>({ prefix: "fakebox:/" })].map(([k]) =>
        k.slice("fakebox:".length)
      );
    const put = (path: string, bytes: Uint8Array) => kv.put(key(path), bytes);
    let runningHere = false;
    const isRunning = () =>
      kv.get("fakebox:lose") === true
        ? runningHere
        : kv.get("fakebox:running") === true;
    const setRunning = (running: boolean) => {
      runningHere = running;
      kv.put("fakebox:running", running);
    };
    const wipe = () => {
      for (const path of paths()) {
        kv.delete(key(path));
      }
    };
    // What the platform's exec() does on a box that isn't running.
    const live = () => {
      if (!isRunning()) {
        throw new Error("the container is not running");
      }
    };
    const get = (path: string, operation: string) => {
      live();
      const bytes = kv.get<Uint8Array>(key(path));
      if (!bytes) {
        throw fileError("ENOENT", operation, path);
      }
      return bytes;
    };
    const isDir = (path: string) =>
      path === "/workspace" || paths().some((p) => p.startsWith(`${path}/`));
    const stat = (path: string, operation: string) => {
      live();
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
        wipe();
      } else if (command.includes("/opt/hopon/playtest.js")) {
        const game = new TextDecoder().decode(
          kv.get<Uint8Array>(key("/workspace/game.ts"))
        );
        put(
          "/workspace/game.js",
          encode(game.includes("speed = 3") ? "// built 3" : "// built")
        );
        put("/workspace/playtest-start.png", PNG);
        put("/workspace/playtest-end.png", PNG);
        return ok(`${game.includes("BROKEN") ? RED : PLAYTEST}\n`);
      } else if (command.includes("node music.mjs")) {
        put("/workspace/music.opus", OPUS);
        return ok("30.0\n");
      }
      return ok();
    };
    return Layer.succeed(AgentSandbox, {
      destroy: Effect.sync(() => {
        log("destroy");
        destroyed.add(this.name);
        setRunning(false);
      }),
      exec: (argv, options) => {
        live();
        const command = argv.join(" ");
        log(command);
        if (command.includes("sleep 600")) {
          // Ends only when aborted.
          const ended = Promise.withResolvers<Exec>();
          options?.signal?.addEventListener("abort", () =>
            ended.resolve({ exitCode: 143, stderr: "", stdout: encode("") })
          );
          return ended.promise;
        }
        return Promise.resolve(fakeExec(command));
      },
      files: {
        lstat: (path) => stat(path, "lstat"),
        mkdir: () => {
          live();
          return Promise.resolve();
        },
        readDirectory: (path) => {
          live();
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
          live();
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
          live();
          put(path, new Uint8Array(await new Response(content).arrayBuffer()));
        },
      },
      keepAlive: Effect.sync(() => log("inactivity timeout")),
      running: Effect.sync(isRunning),
      // Plain `wrangler dev`'s failure: no container at all, once.
      start: Effect.suspend(() => {
        if (kv.get("fakebox:nobox") === true) {
          kv.delete("fakebox:nobox");
          return Effect.fail(new NoBox());
        }
        log("start");
        wipe();
        setRunning(true);
        return Effect.void;
      }),
    });
  }

  // The restart test waits for this line: a job pi finished with nobody connected.
  override async finish(...args: Parameters<RealMaker["finish"]>) {
    const event = await super.finish(...args);
    console.info(
      `Maker ${this.name}: job ${args[0].job.spec.brief} ${event.type}`,
      event.type === "failed" ? event.reason : ""
    );
    return event;
  }

  override armDeadline(...args: Parameters<RealMaker["armDeadline"]>) {
    const [state] = args;
    const { job } = this;
    if (job && state.job.spec.brief.startsWith("late") && !job.stopped) {
      const deadlineAt = Math.min(state.deadlineAt, Date.now() + 1000);
      this.job = { ...job, deadlineAt };
      super.armDeadline({ ...state, deadlineAt });
      return;
    }
    super.armDeadline(state);
  }

  override onRequest(request: Request) {
    const { pathname } = new URL(request.url);
    const { kv } = this.ctx.storage;
    if (pathname === "/fake/log") {
      return Promise.resolve(Response.json(kv.get("fakelog") ?? []));
    }
    if (pathname === "/fake/destroyed") {
      return Promise.resolve(Response.json(destroyed.has(this.name)));
    }
    if (pathname === "/fake/calls") {
      return Promise.resolve(Response.json(subCalls.get(this.name) ?? 0));
    }
    if (pathname === "/fake/release") {
      gate(this.name).resolve();
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    // The box stops (idle), and the next start fails.
    if (pathname === "/fake/nobox") {
      kv.put("fakebox:running", false);
      kv.put("fakebox:nobox", true);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (pathname === "/fake/lose") {
      kv.put("fakebox:lose", true);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return super.onRequest(request);
  }
}
