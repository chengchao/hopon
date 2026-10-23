// POST /jobs/:jobId with the box and the model faked at their service edges: a box in memory, and a model that answers
// pi-ai's real Anthropic requests with scripted SSE. Build quality is the eval's (eval/), not these tests'.
import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import type { Sandbox } from "e2b";
import { Layer } from "effect";

import type { CoderEvent } from "./coder.ts";
import { CANDIDATES } from "./models.ts";
import type { ModelHandler } from "./models.ts";
import { Box, makeCoder, Models } from "./server.ts";

const GAME = "hopon.title = 'Dot'; function gameRender() {}";
const JOB = {
  draftId: "draft-1",
  revision: 0,
  source: {},
  spec: { brief: "Tap the dot.", music: null, title: "Dot" },
};

// The box: files in a Map, the playtest always green, every other command a no-op.
// `open` resolves after `openMs`, or fails when `openFails`; `pause` takes `pauseMs`; `kill` empties the box, or fails
// when `killFails`.
const fakeBox = ({
  openMs = 0,
  pauseMs = 0,
  openFails = false,
  killFails = false,
} = {}) => {
  const files = new Map<string, string>();
  // `overlapped`: a job opened the box while another still had it (before its pause).
  const state = { inUse: false, opened: 0, overlapped: false, paused: 0 };
  const sandbox = {
    commands: {
      run: (command: string, options?: { background?: boolean }) => {
        if (command.startsWith("find /workspace")) {
          files.clear();
        }
        if (options?.background) {
          return Promise.resolve({
            kill: () => Promise.resolve(true),
            wait: () => Promise.resolve({ exitCode: 0 }),
          });
        }
        if (command.includes("playtest.js")) {
          files.set("/workspace/game.js", "// emitted");
          files.set("/workspace/playtest-start.png", "png");
          files.set("/workspace/playtest-end.png", "png!");
          const result = { errors: [], ok: true, typeErrors: [] };
          return Promise.resolve({
            exitCode: 0,
            stderr: "",
            stdout: JSON.stringify(result),
          });
        }
        return Promise.resolve({ exitCode: 0, stderr: "", stdout: "" });
      },
    },
    files: {
      exists: (file: string) => Promise.resolve(files.has(file)),
      makeDir: () => Promise.resolve(true),
      read: (file: string, options?: { format?: string }) => {
        const text = files.get(file);
        if (text === undefined) {
          return Promise.reject(new Error(`${file} not found`));
        }
        return Promise.resolve(
          options?.format === "bytes" ? new TextEncoder().encode(text) : text
        );
      },
      write: (file: string, text: string) => {
        files.set(file, text);
        return Promise.resolve({ path: file });
      },
    },
  } as unknown as Sandbox;
  const box = Layer.succeed(Box)({
    kill: () => {
      if (killFails) {
        return Promise.reject(new Error("E2B is down"));
      }
      files.clear();
      return Promise.resolve();
    },
    open: async () => {
      await sleep(openMs);
      if (openFails) {
        throw new Error("E2B is down");
      }
      state.opened += 1;
      state.overlapped ||= state.inUse;
      state.inUse = true;
      return sandbox;
    },
    pause: async () => {
      state.paused += 1;
      await sleep(pauseMs);
      state.inUse = false;
    },
  });
  return { box, files, state };
};

// Anthropic's streamed message, as SSE.
const sse = (events: Record<string, unknown>[]) =>
  events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
const start = {
  message: {
    content: [],
    id: "msg",
    model: "claude-haiku-5-5",
    role: "assistant",
    stop_reason: null,
    type: "message",
    usage: { input_tokens: 1, output_tokens: 1 },
  },
  type: "message_start",
};
const message = (
  block: Record<string, unknown>,
  delta: Record<string, unknown>,
  stop: "tool_use" | "end_turn"
) =>
  sse([
    start,
    { content_block: block, index: 0, type: "content_block_start" },
    { delta, index: 0, type: "content_block_delta" },
    { index: 0, type: "content_block_stop" },
    {
      delta: { stop_reason: stop },
      type: "message_delta",
      usage: { output_tokens: 1 },
    },
    { type: "message_stop" },
  ]);
let calls = 0;
const toolCall = (name: string, input: unknown) => {
  calls += 1;
  return message(
    { id: `toolu_${calls}`, input: {}, name, type: "tool_use" },
    { partial_json: JSON.stringify(input), type: "input_json_delta" },
    "tool_use"
  );
};
const reply = (text: string) =>
  message({ text: "", type: "text" }, { text, type: "text_delta" }, "end_turn");

// Each model request gets the next scripted body.
const scripted =
  (bodies: (string | ReadableStream<Uint8Array>)[]): ModelHandler =>
  async (request) => {
    await request.text();
    return new Response(bodies.shift() ?? reply("Out of script."), {
      headers: { "content-type": "text/event-stream" },
    });
  };

const coder = (
  handler: ModelHandler,
  box = fakeBox(),
  { deadlineMs, pingMs }: { deadlineMs?: number; pingMs?: number } = {}
) =>
  makeCoder(
    Layer.mergeAll(
      box.box,
      Layer.succeed(Models)({
        handler,
        model: CANDIDATES["claude-haiku-5-5"](),
        thinking: "low",
      })
    ),
    { deadlineMs, draftId: JOB.draftId, pingMs }
  );

const post = (handle: ReturnType<typeof coder>, path: string, body?: unknown) =>
  handle(
    new Request(`http://coder${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      method: "POST",
    })
  );

const events = async (response: Response) => {
  const text = await response.text();
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as CoderEvent | { type: "ping" })
    .filter((event) => event.type !== "ping");
};

const buildsADot = () => [
  toolCall("write", { content: GAME, path: "game.ts" }),
  toolCall("playtest", { inputs: [] }),
  reply("A dot to tap."),
];

test("a job streams its steps and playtest, then the changed files", async () => {
  const box = fakeBox();
  const handle = coder(scripted(buildsADot()), box);
  const response = await post(handle, "/jobs/job-1", JOB);
  assert.equal(response.headers.get("content-type"), "application/x-ndjson");
  assert.deepEqual(await events(response), [
    { label: "Writing the game", type: "step" },
    { label: "Playtesting", type: "step" },
    { errors: [], ok: true, type: "playtest" },
    {
      deleted: [],
      files: { "game.js": "// emitted", "game.ts": GAME },
      summary: "A dot to tap.",
      type: "done",
    },
  ]);
  assert.equal(box.state.paused, 1);

  // Within 10 minutes the same job attaches to its record instead of building again.
  const again = await events(await post(handle, "/jobs/job-1", JOB));
  assert.equal(again.at(-1)?.type, "done");
  assert.equal(box.state.paused, 1);
});

test("a job without a green playtest fails", async () => {
  const handle = coder(
    scripted([
      toolCall("write", { content: GAME, path: "game.ts" }),
      reply("Done."),
    ])
  );
  const sent = await events(await post(handle, "/jobs/job-2", JOB));
  assert.deepEqual(sent.at(-1), {
    reason: "never playtested",
    type: "failed",
  });
});

test("a job past its deadline fails, and its stalled model request is aborted", async () => {
  // The model sends its headers and the start of a message, then nothing: a hung request.
  let cancelled = false;
  const stalled = new ReadableStream<Uint8Array>({
    cancel: () => {
      cancelled = true;
    },
    start: (controller) =>
      controller.enqueue(new TextEncoder().encode(sse([start]))),
  });
  const handle = coder(scripted([stalled]), fakeBox(), { deadlineMs: 300 });
  const began = Date.now();
  const sent = await events(await post(handle, "/jobs/job-3", JOB));
  assert.deepEqual(sent, [
    { reason: "past the 0.3 s deadline", type: "failed" },
  ]);
  assert.ok(Date.now() - began < 3000, `ended after ${Date.now() - began} ms`);
  assert.ok(cancelled, "the model request was not aborted");
});

test("cancel ends a running job failed; another job meanwhile is busy", async () => {
  const stalled = new ReadableStream<Uint8Array>({
    start: (controller) =>
      controller.enqueue(new TextEncoder().encode(sse([start]))),
  });
  const handle = coder(scripted([stalled]));
  const running = post(handle, "/jobs/job-4", JOB);
  await sleep(100);
  assert.deepEqual(await events(await post(handle, "/jobs/job-5", JOB)), [
    { reason: "busy", type: "failed" },
  ]);
  const cancelled = await post(handle, "/jobs/job-4/cancel");
  assert.equal(cancelled.status, 204);
  assert.deepEqual(await events(await running), [
    { reason: "cancelled", type: "failed" },
  ]);
});

test("the deadline counts from the job's arrival, so a slow box open counts too", async () => {
  const handle = coder(scripted(buildsADot()), fakeBox({ openMs: 1000 }), {
    deadlineMs: 300,
  });
  const began = Date.now();
  const sent = await events(await post(handle, "/jobs/job-6", JOB));
  assert.deepEqual(sent, [
    { reason: "past the 0.3 s deadline", type: "failed" },
  ]);
  // Reported at the deadline, while the box is still opening.
  assert.ok(Date.now() - began < 800, `ended after ${Date.now() - began} ms`);
});

test("a running job's stream pings", async () => {
  const handle = coder(scripted(buildsADot()), fakeBox({ openMs: 120 }), {
    pingMs: 50,
  });
  const response = await post(handle, "/jobs/job-7", JOB);
  const text = await response.text();
  assert.ok(text.startsWith(`${JSON.stringify({ type: "ping" })}\n`), text);
});

test("a job that isn't for this Draft, or isn't a job, is refused", async () => {
  const handle = coder(scripted(buildsADot()));
  const other = await post(handle, "/jobs/job-8", {
    ...JOB,
    draftId: "draft-2",
  });
  assert.equal(other.status, 400);
  const broken = await post(handle, "/jobs/job-9", { ...JOB, revision: "one" });
  assert.equal(broken.status, 400);
});

test("after DELETE /box a job still builds, in a box restored from its source", async () => {
  const box = fakeBox();
  const handle = coder(scripted(buildsADot()), box);
  box.files.set("/workspace/old.ts", "stale");
  const killed = await handle(
    new Request("http://coder/box", { method: "DELETE" })
  );
  assert.equal(killed.status, 204);
  assert.equal(box.files.size, 0);
  const sent = await events(
    await post(handle, "/jobs/job-14", { ...JOB, source: { "a.ts": "a" } })
  );
  assert.equal(sent.at(-1)?.type, "done");
  assert.equal(box.files.get("/workspace/a.ts"), "a");
});

test("DELETE /box answers 502 when the box can't be killed", async () => {
  const handle = coder(scripted([]), fakeBox({ killFails: true }));
  const response = await handle(
    new Request("http://coder/box", { method: "DELETE" })
  );
  assert.equal(response.status, 502);
});

test("a job whose box won't open fails with the box's own error", async () => {
  const handle = coder(scripted([]), fakeBox({ openFails: true }));
  const sent = await events(await post(handle, "/jobs/job-10", JOB));
  assert.deepEqual(sent, [
    { reason: "coder error: Error: E2B is down", type: "failed" },
  ]);
});

test("the same job posted again while it runs attaches: one run, the same events", async () => {
  const box = fakeBox({ openMs: 100 });
  const handle = coder(scripted(buildsADot()), box);
  const first = post(handle, "/jobs/job-11", JOB);
  await sleep(20);
  const second = post(handle, "/jobs/job-11", JOB);
  const [a, b] = await Promise.all([first.then(events), second.then(events)]);
  assert.equal(a.at(-1)?.type, "done");
  assert.deepEqual(b, a);
  assert.equal(box.state.opened, 1);
});

test("cancel while the box opens ends the job at once; the next job waits for the box and starts from its source", async () => {
  const box = fakeBox({ openMs: 300, pauseMs: 300 });
  const handle = coder(
    scripted([
      toolCall("write", { content: "junk", path: "junk.ts" }),
      ...buildsADot(),
    ]),
    box
  );
  const running = post(handle, "/jobs/job-12", JOB);
  await sleep(50);
  const began = Date.now();
  await post(handle, "/jobs/job-12/cancel");
  assert.deepEqual(await events(await running), [
    { reason: "cancelled", type: "failed" },
  ]);
  assert.ok(Date.now() - began < 200, `ended after ${Date.now() - began} ms`);

  const next = await events(
    await post(handle, "/jobs/job-13", { ...JOB, source: { "old.ts": "x" } })
  );
  assert.deepEqual(next.at(-1), {
    deleted: [],
    files: { "game.js": "// emitted", "game.ts": GAME },
    summary: "A dot to tap.",
    type: "done",
  });
  assert.equal(box.files.get("/workspace/old.ts"), "x");
  assert.equal(box.state.overlapped, false);
});
