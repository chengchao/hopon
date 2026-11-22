// The Worker for test/maker.test.js: the real API and Maker (src/maker.ts), with the model and the sandbox faked.
// - The model: every model call ends at globalThis.fetch, which answers Cloudflare's /ai/v1/messages here, as a
//   scripted Anthropic stream. A Creator message "build <script>" plays SCRIPTS[script], one tool call per model call
//   since that message; a script's end, and any other message, gets a text reply that repeats what the model was last
//   sent, a tool's result included. A step can carry a note: text in the same message as its tool call. Each call
//   reads 1,000 input tokens, 1,000 hopon tokens at Haiku 5.5's $0.10 a million, or n after "spend <n>"; "no credits"
//   gets the gateway's 402. A call with no tools is the advisor's (src/advisor.ts): it gets fixed advice, a 400 for the
//   question "advisor fails", or an empty answer cut at max_tokens for "advisor silent", and isn't counted in `calls`.
//   One whose system prompt is the designer's (src/designer.ts) gets a fixed design, or a 400 for "designerfails".
// - The sandbox: files in the Maker's own storage (so they outlive a restart, as a running box does), every command
//   logged and answered by fakeExec: the playtest green unless game.ts says BROKEN, the check's tests red on that,
//   building dist/ (as `vite build` would in a workspace with a vite.config.ts); music.mjs rendering a fixed track; tar packing the workspace's source into source.tgz as JSON (its
//   files' text by name) and unpacking it; `stat` and `find` giving sizes; `rm -f <files>` deleting them; the rest a no-op. As the platform's, a stopped box
//   refuses every command and file, and one started again is empty.
// /__maker/<draftId>/fake/<what> (MAKER_DEV's route) reaches the Draft's Maker: `log` returns the box's commands, and
// its start, destroy and inactivity timeout; `puts` the start and end of each R2 put; `release` lets a held step answer; `nobox` stops the box and makes its
// next start fail; `lose` makes the box stop with the server, as a box on another host would; `stopbox` stops it once;
// `slowplay/<ms>` slows its next playtest; `hangplay` times its next playtest out, as `timeout` would, and `sleep 9999`
// always times out; `age/<s>` moves the run in flight's start <s> seconds back; `stopatverify` stops the box once `build`'s verify has answered;
// `partial` leaves the next Revision half-written in R2, as an eviction mid-build would; `legacy` writes the next
// Revision as one from before source.tgz; `calls` counts the model calls; `advisor` returns the advisor's requests; `mistagged` counts calls whose gateway tag
// doesn't name the Maker; `destroyed` says whether the Draft's box was destroyed, and `startsafterdestroy` how often it
// started after that.
import { Effect, Layer } from "effect";

import { MAX_STEPS } from "../../../maker/src/job.ts";
import { AgentSandbox, NoBox } from "../../src/agent-sandbox.ts";
import type { Exec } from "../../src/agent-sandbox.ts";
import { Maker as RealMaker } from "../../src/maker.ts";
import { currentRevision, revisionFiles } from "../../src/storage.ts";

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
interface Step {
  tool: string;
  input: object;
  // Text in the same message as the tool call.
  note?: string;
  // Waits for `release` before it answers.
  hold?: true;
  // Answers after this many ms: time to kill the server mid-run.
  sleep?: number;
}

const GAME = "let speed = 1;\nfunction gameRender() {}\n";
const write = (content = GAME) => ({
  input: { content, path: "game.ts" },
  tool: "write",
});
const play = { input: {}, tool: "playtest" };
const edit = (to: string) => ({
  input: { edits: [{ newText: to, oldText: "speed = 1" }], path: "game.ts" },
  tool: "edit",
});
const build = (kind: "new" | "change", music = false) => ({
  input: {
    description: "Tap to jump from moon to moon.",
    kind,
    music,
    title: "Moon Cat",
  },
  tool: "build",
});
const READ_ASKED = { input: { path: ".hopon/asked.json" }, tool: "read" };
const DESIGN = "# Moon Cat design\n";
const TESTS = '{"expose": [], "tests": []}';
const ADVISE = {
  input: { question: "Should the level data live apart from the physics?" },
  tool: "ask_advisor",
};
// A Vite game's workspace (ADR 0007), as P5's agent will write it.
const writeFile = (path: string, content: string) => ({
  input: { content, path },
  tool: "write",
});
const VITE_GAME = [
  writeFile("vite.config.ts", "export default {};\n"),
  writeFile(
    "index.html",
    '<script src="/hopon/v2.js"></script><script type="module" src="/src/main.tsx"></script>\n'
  ),
  writeFile("src/main.tsx", "hopon.ready();\n"),
  writeFile("design.md", DESIGN),
  writeFile("tests.json", TESTS),
  writeFile("music.mjs", "// a track"),
];
const SCRIPTS: Record<string, readonly Step[]> = {
  // Writes the game, then asks the advisor.
  advised: [write(), ADVISE],
  // Asks the advisor for the done check, then builds the change.
  advisedbuild: [edit("speed = 2"), play, ADVISE, build("change")],
  // Asks the advisor, which fails, then writes the game.
  advisorfails: [
    { input: { question: "advisor fails" }, tool: "ask_advisor" },
    write(),
  ],
  // Asks the advisor, which answers nothing, then writes the game.
  advisorsilent: [
    { input: { question: "advisor silent" }, tool: "ask_advisor" },
    write(),
  ],
  // Reads what the Creator has said, from the file the Maker keeps in the box.
  asked: [READ_ASKED],
  // Green under its own playtest, red under build's check.
  broken: [write(`${GAME}// BROKEN\n`), play, build("change")],
  change: [edit("speed = 2"), play, build("change")],
  // Fails build's check, then reads what the Creator has said.
  checkedasked: [write(`${GAME}// BROKEN\n`), build("change"), READ_ASKED],
  // A first game with its design and tests.
  designed: [
    write(),
    { input: { content: DESIGN, path: "design.md" }, tool: "write" },
    { input: { content: TESTS, path: "tests.json" }, tool: "write" },
    play,
    build("new"),
  ],
  // Has the designer design the game, then reads the design.md it wrote.
  designer: [
    { input: { imitates: "Moon Cat" }, tool: "design_game" },
    { input: { path: "design.md" }, tool: "read" },
  ],
  // Asks the designer, which fails, then writes the game.
  designerfails: [{ input: {}, tool: "design_game" }, write()],
  // Builds 5 times: the build limit's case.
  five: [
    write(),
    build("new"),
    ...Array.from({ length: 4 }, () => build("change")),
  ],
  // Fails build, fixes the game, and builds it.
  fix: [write(`${GAME}// BROKEN\n`), build("change"), write(), build("change")],
  // A start over: empties the workspace, then writes a new game without music.
  fresh: [
    {
      input: {
        command:
          "rm -f design.md game.ts index.html music.mjs music.py tests.json",
      },
      tool: "bash",
    },
    write(),
    play,
    build("new"),
  ],
  // Loads make-game and reads its Phaser guide, then the panels example before any playtest, then a guide it doesn't have.
  guide: [
    { input: { name: "make-game" }, tool: "activate_skill" },
    {
      input: { name: "make-game", path: "references/phaser.md" },
      tool: "read_skill_resource",
    },
    {
      input: {
        name: "make-game",
        path: "references/phaser-panels-example.md",
      },
      tool: "read_skill_resource",
    },
    {
      input: { name: "make-game", path: "references/littlejs.md" },
      tool: "read_skill_resource",
    },
  ],
  // Runs a command until it's stopped.
  hang: [{ input: { command: "sleep 600" }, tool: "bash" }],
  // Writes once released, then builds and playtests: the ceiling's case, once the run is aged past it.
  late: [write(), play, { ...write(), hold: true }, build("new"), play],
  // Builds a broken game once released, then builds it again.
  latebroken: [
    write(`${GAME}// BROKEN\n`),
    play,
    { ...build("new"), hold: true },
    build("new"),
  ],
  // Writes once more than the step limit allows, then builds and playtests: the step limit's case.
  loop: [
    ...Array.from({ length: MAX_STEPS + 1 }, () => write()),
    build("new"),
    play,
  ],
  // A first game with music.
  music: [
    write(),
    { input: { content: "// a track", path: "music.mjs" }, tool: "write" },
    play,
    build("new", true),
  ],
  new: [write(), play, build("new")],
  // Writes a note to itself before it builds.
  noted: [
    write(),
    { ...play, note: "Note to self: the jump checks out." },
    build("change"),
  ],
  // One tool call.
  one: [write()],
  // Reads the game's design.
  readdesign: [{ input: { path: "design.md" }, tool: "read" }],
  // Changes the game, then builds after 2 s.
  slow: [edit("speed = 3"), play, { ...build("change"), sleep: 2000 }],
  // A bash command that runs out of time, asking for far more than the command timeout, then two playtests and a
  // build: `hangplay` times the first out.
  timedout: [
    write(),
    { input: { command: "sleep 9999", timeout: 9999 }, tool: "bash" },
    play,
    play,
    build("new"),
  ],
  // Builds two new games in one run, then reads what the Creator has said.
  twice: [write(), build("new"), build("new"), READ_ASKED],
  // A Vite game with music, played and built new.
  vite: [...VITE_GAME, play, build("new", true)],
  // Changes the game, then builds once released.
  wait: [edit("speed = 3"), play, { ...build("change"), hold: true }],
  // Writes a new game, then builds it once released.
  waitnew: [write(), play, { ...build("new"), hold: true }],
  // Writes once released.
  waitwrite: [{ ...write(), hold: true }],
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

// One assistant message of these content blocks, each with its one delta.
const reply = (
  blocks: readonly { block: object; delta: object }[],
  stop: string,
  input: number
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
        usage: { input_tokens: input, output_tokens: 0 },
      },
      type: "message_start",
    },
    ...blocks.flatMap(({ block, delta }, index) => [
      { content_block: block, index, type: "content_block_start" },
      { delta, index, type: "content_block_delta" },
      { index, type: "content_block_stop" },
    ]),
    {
      delta: { stop_reason: stop, stop_sequence: null },
      type: "message_delta",
      usage: { output_tokens: 0 },
    },
    { type: "message_stop" },
  ]);

const text = (said: string) => ({
  block: { text: "", type: "text" },
  delta: { text: said, type: "text_delta" },
});
const toolCall = ({ input, note, tool }: Step, tokens: number) =>
  reply(
    [
      ...(note === undefined ? [] : [text(note)]),
      {
        block: {
          id: `toolu_${crypto.randomUUID().replaceAll("-", "")}`,
          input: {},
          name: tool,
          type: "tool_use",
        },
        delta: {
          partial_json: JSON.stringify(input),
          type: "input_json_delta",
        },
      },
    ],
    "tool_use",
    tokens
  );
const say = (said: string, tokens: number) =>
  reply([text(said)], "end_turn", tokens);

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
const calls = new Map<string, number>();
const mistagged = new Map<string, number>();
// The Drafts whose box was destroyed, outside the Maker's storage, which a Delete removes.
const destroyed = new Set<string>();
const startsAfterDestroy = new Map<string, number>();

// The advisor's requests, whole, per Draft.
const advisorRequests = new Map<string, unknown[]>();

const TOKENS = 1000;

// What the designer answers: a whole design.md.
const SEA_DESIGN =
  "# Sea Trader\n\n**Music:** a shanty\n\n**Done when:**\n- It sails.";

// The advisor's call, or the designer's (src/designer.ts): the only ones with no tools.
const advise = (
  draftId: string,
  body: { messages: Message[]; system?: unknown }
) => {
  advisorRequests.set(draftId, [...(advisorRequests.get(draftId) ?? []), body]);
  const question = texts(body.messages.at(-1)?.content).join("");
  if (JSON.stringify(body.system ?? "").includes("You are the designer")) {
    return question.includes("designerfails")
      ? Response.json(
          {
            error: {
              message: "the designer is down",
              type: "invalid_request_error",
            },
          },
          { status: 400 }
        )
      : say(SEA_DESIGN, TOKENS);
  }
  if (question.includes("advisor silent")) {
    return reply([], "max_tokens", TOKENS);
  }
  if (question.includes("advisor fails")) {
    return Response.json(
      {
        error: {
          message: "the advisor is down",
          type: "invalid_request_error",
        },
      },
      { status: 400 }
    );
  }
  return say("advice: keep the levels in their own file.", TOKENS);
};

const model = async (request: Request) => {
  const { agent, draftId } = JSON.parse(
    request.headers.get("cf-aig-metadata") ?? "{}"
  ) as { agent: string; draftId: string };
  if (agent !== "maker") {
    mistagged.set(draftId, (mistagged.get(draftId) ?? 0) + 1);
  }
  const body = await request.json<{ messages: Message[]; tools?: unknown }>();
  if (!("tools" in body)) {
    return advise(draftId, body);
  }
  calls.set(draftId, (calls.get(draftId) ?? 0) + 1);
  const { messages } = body;
  const said = texts(messages.at(-1)?.content);
  if (said.includes("no credits")) {
    return Response.json(
      {
        error: "Insufficient unified billing balance; available balance $0.00",
      },
      { status: 402 }
    );
  }
  const asked = messages.findLastIndex(
    ({ content, role }) =>
      role === "user" &&
      (typeof content === "string" ||
        content.every((block) => block.type !== "tool_result"))
  );
  const name = texts(messages[asked]?.content)
    .find((line) => line.startsWith("build "))
    ?.slice(6);
  const script = SCRIPTS[name ?? ""];
  const turn = messages
    .slice(asked)
    .filter(({ role }) => role === "assistant").length;
  const step = script?.[turn];
  if (!step) {
    const spend = said.find((line) => line.startsWith("spend "))?.slice(6);
    return say(
      `said: ${said.join(" | ")}`,
      spend === undefined ? TOKENS : Number(spend)
    );
  }
  if (step.hold) {
    // An aborted run's model call ends, as a real one does.
    const aborted = Promise.withResolvers<undefined>();
    request.signal.addEventListener("abort", () =>
      aborted.reject(request.signal.reason)
    );
    await Promise.race([gate(draftId).promise, aborted.promise]);
    gates.delete(draftId);
  }
  if (step.sleep) {
    await scheduler.wait(step.sleep);
  }
  return toolCall(step, TOKENS);
};

const upstream = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const request = new Request(input, init);
  return new URL(request.url).pathname.endsWith("/ai/v1/messages")
    ? model(request)
    : upstream(request);
};

const encode = (value: string) => new TextEncoder().encode(value);
const GREEN = JSON.stringify({ errors: [], ok: true, typeErrors: [] });
const RED = JSON.stringify({ errors: ["boom"], ok: false, typeErrors: [] });
// A PNG's first bytes are enough for a screenshot nobody looks at.
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const OPUS = new Uint8Array([79, 103, 103, 83]);
const REMOVE = /\brm -f (?<files>[\w. ]+)$/u;
// What job.ts's tar leaves out of the source.
const NOT_SOURCE =
  /^\/workspace\/(?:dist\/|\.hopon\/|node_modules\/|game\.js$|music\.opus$|playtest-)|\.(?:wav|mid)$/u;
const PACKED = "/tmp/hopon-source.tgz";
const decode = (bytes: Uint8Array | undefined) =>
  new TextDecoder().decode(bytes);

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

// Each R2 put's start and end, in order, per Draft: when each of a Revision's files was written.
const puts = new Map<string, string[]>();
const recording = (files: R2Bucket, draftId: () => string): R2Bucket =>
  new Proxy(files, {
    get: (target, name) => {
      const value = Reflect.get(target, name) as unknown;
      if (name !== "put" || typeof value !== "function") {
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args: Parameters<R2Bucket["put"]>) => {
        const log = puts.get(draftId()) ?? [];
        puts.set(draftId(), log);
        log.push(`start ${args[0]}`);
        const put = await target.put(...args);
        log.push(`end ${args[0]}`);
        return put;
      };
    },
  });

const answer = (body: unknown) => Promise.resolve(Response.json(body));
const done = () => Promise.resolve(new Response(null, { status: 204 }));

export class Maker extends RealMaker {
  constructor(ctx: DurableObjectState, env: Env) {
    const self: { maker?: Maker } = {};
    super(ctx, {
      ...env,
      FILES: recording(env.FILES, () => self.maker?.name ?? ""),
    });
    self.maker = this;
  }

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
    // source.tgz as JSON: the workspace's source files' text by name.
    const pack = () => {
      const source = Object.fromEntries(
        paths()
          .filter((p) => p.startsWith("/workspace/") && !NOT_SOURCE.test(p))
          .toSorted()
          .map((p) => [
            p.slice("/workspace/".length),
            decode(kv.get<Uint8Array>(key(p))),
          ])
      );
      put(PACKED, encode(JSON.stringify(source)));
    };
    const unpack = () => {
      const source = JSON.parse(
        decode(kv.get<Uint8Array>(key(PACKED)))
      ) as Record<string, string>;
      for (const [name, content] of Object.entries(source)) {
        put(`/workspace/${name}`, encode(content));
      }
    };
    const size = (path: string) => kv.get<Uint8Array>(key(path))?.length ?? 0;
    // What `stat` says of source.tgz and `find` of dist/: sizes in bytes. Null for any other command.
    const sizes = (command: string) => {
      if (command.includes(`/usr/bin/stat --format=%s ${PACKED}`)) {
        return `${size(PACKED)}\n`;
      }
      if (!command.includes("/usr/bin/find /workspace/dist")) {
        return null;
      }
      return paths()
        .filter((p) => p.startsWith("/workspace/dist/"))
        .map((p) => `${size(p)} ${p.slice("/workspace/dist/".length)}\0`)
        .join("");
    };
    // The playtest's dist/: a Vite game's page and its one module, or game.ts's page and game.js, and the music.
    const buildDist = (game: string) => {
      const opus = kv.get<Uint8Array>(key("/workspace/music.opus"));
      const music = opus ? ' data-music="music.opus"' : "";
      if (opus) {
        put("/workspace/dist/music.opus", opus);
      }
      if (kv.get(key("/workspace/vite.config.ts")) !== undefined) {
        put("/workspace/dist/index-B1x2.js", encode("hopon.ready();"));
        put(
          "/workspace/dist/index.html",
          encode(
            `<script src="/hopon/v2.js"${music}></script><script type="module" crossorigin src="./index-B1x2.js"></script>`
          )
        );
        return;
      }
      put(
        "/workspace/dist/game.js",
        encode(game.includes("speed = 3") ? "// built 3" : "// built")
      );
      put(
        "/workspace/dist/index.html",
        encode(`<script src="/runtime/v4.js"${music}></script>`)
      );
    };
    const fakeExec = (command: string): Exec => {
      const listed = sizes(command);
      if (listed !== null) {
        return ok(listed);
      }
      const removed = REMOVE.exec(command)?.groups?.files;
      if (removed) {
        for (const file of removed.split(" ")) {
          kv.delete(key(`/workspace/${file}`));
        }
      } else if (command.includes(`/usr/bin/tar --create --file ${PACKED}`)) {
        pack();
      } else if (command.includes(`/usr/bin/tar --extract --file ${PACKED}`)) {
        unpack();
      } else if (command.includes("/usr/bin/find /workspace")) {
        wipe();
      } else if (command.includes("/opt/hopon/playtest.js")) {
        const game = decode(kv.get<Uint8Array>(key("/workspace/game.ts")));
        buildDist(game);
        put("/workspace/playtest-start.png", PNG);
        put("/workspace/playtest-end.png", PNG);
        if (command.includes("/opt/hopon/playtest.js tests ")) {
          const red = game.includes("BROKEN");
          return ok(
            `${JSON.stringify({ failures: red ? ["boom"] : [], ok: !red, testErrors: [], typeErrors: [] })}\n`
          );
        }
        return ok(`${game.includes("BROKEN") ? RED : GREEN}\n`);
      } else if (
        command.includes("/opt/hopon/verify.js") &&
        kv.get("fakebox:stopatverify") === true
      ) {
        kv.delete("fakebox:stopatverify");
        setRunning(false);
      } else if (command.includes("ffprobe")) {
        return ok("30.0\n");
      } else if (command.includes("ffmpeg")) {
        put("/workspace/music.opus", OPUS);
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
        // A slow playtest, once: it runs `fakebox:slowplay` ms, or until it's aborted.
        const slow = kv.get<number>("fakebox:slowplay");
        if (slow && command.includes("/opt/hopon/playtest.js")) {
          kv.delete("fakebox:slowplay");
          const ended = Promise.withResolvers<Exec>();
          const timer = setTimeout(
            () => ended.resolve(fakeExec(command)),
            slow
          );
          options?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            ended.resolve({ exitCode: 143, stderr: "", stdout: encode("") });
          });
          return ended.promise;
        }
        // What `timeout` gives back for a command that ran past its seconds: exit 124 and no output.
        const timedOut = { exitCode: 124, stderr: "", stdout: encode("") };
        if (command.includes("sleep 9999")) {
          return Promise.resolve(timedOut);
        }
        if (
          kv.get("fakebox:hangplay") === true &&
          command.includes("/opt/hopon/playtest.js")
        ) {
          kv.delete("fakebox:hangplay");
          return Promise.resolve(timedOut);
        }
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
        if (destroyed.has(this.name)) {
          startsAfterDestroy.set(
            this.name,
            (startsAfterDestroy.get(this.name) ?? 0) + 1
          );
        }
        wipe();
        setRunning(true);
        return Effect.void;
      }),
    });
  }

  override onRequest(request: Request) {
    const { pathname } = new URL(request.url);
    const { kv } = this.ctx.storage;
    const reads: Record<string, () => unknown> = {
      "/fake/advisor": () => advisorRequests.get(this.name) ?? [],
      "/fake/calls": () => calls.get(this.name) ?? 0,
      "/fake/destroyed": () => destroyed.has(this.name),
      "/fake/log": () => kv.get("fakelog") ?? [],
      "/fake/mistagged": () => mistagged.get(this.name) ?? 0,
      "/fake/puts": () => puts.get(this.name) ?? [],
      "/fake/startsafterdestroy": () => startsAfterDestroy.get(this.name) ?? 0,
    };
    const read = reads[pathname];
    if (read) {
      return answer(read());
    }
    switch (pathname) {
      case "/fake/release": {
        gate(this.name).resolve();
        return done();
      }
      // The box stops, as an idle or crashed one does; the next start works.
      case "/fake/stopbox": {
        kv.put("fakebox:running", false);
        return done();
      }
      // The box stops (idle), and the next start fails.
      case "/fake/nobox": {
        kv.put("fakebox:running", false);
        kv.put("fakebox:nobox", true);
        return done();
      }
      case "/fake/stopatverify": {
        kv.put("fakebox:stopatverify", true);
        return done();
      }
      case "/fake/hangplay": {
        kv.put("fakebox:hangplay", true);
        return done();
      }
      // Revision n+1 cut short: some files, no index.html.
      case "/fake/partial": {
        return currentRevision(this.env.FILES, this.name).then(async (n) => {
          const next = revisionFiles(this.name, n + 1);
          await this.env.FILES.put(`${next}game.ts`, "// half");
          await this.env.FILES.put(`${next}stale.js`, "// half");
          return new Response(null, { status: 204 });
        });
      }
      // A Revision n+1 from before source.tgz: a LittleJS game with music, design.md beside it, index.html last.
      case "/fake/legacy": {
        return currentRevision(this.env.FILES, this.name).then(async (n) => {
          const next = revisionFiles(this.name, n + 1);
          await Promise.all(
            Object.entries({
              "design.md": "# An older design\n",
              "game.js": "// built long ago",
              "game.ts": "let speed = 1;\nfunction gameRender() {}\n",
              "music.js": 'hopon.music = "T2dnUw==";\n',
              "music.mjs": "// an older track",
            }).map(([name, content]) =>
              this.env.FILES.put(`${next}${name}`, content)
            )
          );
          await this.env.FILES.put(
            `${next}index.html`,
            '<script src="/runtime/v3.js"></script><script src="music.js"></script><script src="game.js"></script>'
          );
          return new Response(null, { status: 204 });
        });
      }
      case "/fake/lose": {
        kv.put("fakebox:lose", true);
        return done();
      }
      default: {
        break;
      }
    }
    // The next playtest takes this many ms: /fake/slowplay/<ms>.
    const slow = /^\/fake\/slowplay\/(?<ms>\d+)$/u.exec(pathname)?.groups?.ms;
    if (slow) {
      kv.put("fakebox:slowplay", Number(slow));
      return done();
    }
    // The run in flight began this many seconds earlier: /fake/age/<s>.
    const age = /^\/fake\/age\/(?<s>\d+)$/u.exec(pathname)?.groups?.s;
    const run = this.runState;
    if (age && run) {
      this.runState = { ...run, startedAt: run.startedAt - Number(age) * 1000 };
      return done();
    }
    return super.onRequest(request);
  }
}
