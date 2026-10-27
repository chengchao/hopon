// The Coder's job contract (#175) under `wrangler dev`, as the Talker calls it: POST /jobs/:jobId with the job, NDJSON
// events back. test/coder/worker.ts fakes the model (a script per brief) and the box (files in the object's storage),
// so this needs no key, no Docker and no model call. More cases (#176, #177) add a brief to its SCRIPTS and a test here.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

const API = new URL("..", import.meta.url).pathname;
const CONFIG = new URL("coder/wrangler.jsonc", import.meta.url).pathname;
const state = mkdtempSync(path.join(tmpdir(), "coder-test-"));
// test/coder/worker.ts's game.ts.
const GAME = "let speed = 1;\nfunction gameRender() {}\n";

const freePort = async () => {
  const server = createServer().listen(0);
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  return port;
};
const ORIGIN = `http://127.0.0.1:${await freePort()}`;

let server;
// The server's output, printed only if the test fails.
const serverLog = [];
const start = async () => {
  server = spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "--config",
      CONFIG,
      "--local",
      "--port",
      new URL(ORIGIN).port,
      "--persist-to",
      state,
    ],
    { cwd: API, detached: true, stdio: ["ignore", "pipe", "pipe"] }
  );
  server.stdout.on("data", (data) => serverLog.push(data));
  server.stderr.on("data", (data) => serverLog.push(data));
  // A Worker that won't build leaves wrangler running, waiting for a fix.
  const deadline = Date.now() + 60_000;
  for (;;) {
    assert.ok(
      server.exitCode === null && Date.now() < deadline,
      Buffer.concat(serverLog).toString()
    );
    try {
      // oxlint-disable-next-line no-await-in-loop -- polling until the server answers
      await fetch(ORIGIN);
      return;
    } catch {
      // oxlint-disable-next-line no-await-in-loop -- polling until the server answers
      await sleep(200);
    }
  }
};
// SIGKILL, so nothing shuts down cleanly: the closest local stand-in for an eviction.
const kill = () => process.kill(-server.pid, "SIGKILL");

const coder = (draft, route, init) =>
  fetch(`${ORIGIN}/__coder/${draft}${route}`, init);

// A job's NDJSON events as they come, without the pings.
const post = async (draft, jobId, job) => {
  const response = await coder(draft, `/jobs/${jobId}`, {
    body: JSON.stringify(job),
    method: "POST",
  });
  if (response.status !== 200) {
    assert.fail(`${response.status} ${await response.text()}`);
  }
  const events = [];
  const read = async () => {
    let buffer = "";
    for await (const chunk of response.body.pipeThrough(
      new TextDecoderStream()
    )) {
      const lines = `${buffer}${chunk}`.split("\n");
      buffer = lines.pop() ?? "";
      events.push(
        ...lines
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .filter((event) => event.type !== "ping")
      );
    }
    return events;
  };
  return { done: read(), events };
};
const build = async (draft, jobId, job) => {
  const { done } = await post(draft, jobId, job);
  return done;
};
const job = (revision, source, brief) => ({
  draftId: "ignored",
  revision,
  source,
  spec: { brief, music: null, title: "Star Catcher" },
});
const until = async (what, check, ms = 20_000) => {
  const deadline = Date.now() + ms;
  while (!check()) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    // oxlint-disable-next-line no-await-in-loop -- polling
    await sleep(50);
  }
};
const boxLog = async (draft) => {
  const response = await coder(draft, "/fake/log");
  return response.json();
};
const restores = async (draft) => {
  const commands = await boxLog(draft);
  return commands.filter((c) => c.includes("find /workspace -mindepth 1"))
    .length;
};

test("a new game and a change to it end done with their files; a re-POST of a running job attaches", async (t) => {
  t.after(kill);
  t.after(() => {
    if (!t.passed) {
      process.stdout.write(Buffer.concat(serverLog));
    }
  });
  await start();

  // A new game: the steps and the green playtest as they happen, then the Revision's files.
  const events = await build("draft-a", "job-1", job(0, {}, "new"));
  const done = events.at(-1);
  assert.deepEqual(events.slice(0, -1), [
    { label: "Writing the game", type: "step" },
    { label: "Playtesting", type: "step" },
    { errors: [], ok: true, type: "playtest" },
  ]);
  assert.deepEqual(Object.keys(done.files).toSorted(), [
    "game.js",
    "game.ts",
    "index.html",
  ]);
  assert.deepEqual(
    { ...done, files: undefined },
    {
      deleted: [],
      files: undefined,
      summary: "Built Star Catcher.",
      type: "done",
    }
  );
  assert.equal(done.files["game.ts"], GAME);
  assert.equal(done.files["game.js"], "// built");
  assert.match(done.files["index.html"], /<script src="game\.js"><\/script>/u);
  assert.doesNotMatch(done.files["index.html"], /music\.js/u);

  // A change to it: the job carries the source, and only what changed comes back.
  const source = {
    "game.ts": done.files["game.ts"],
    "index.html": done.files["index.html"],
  };
  const changed = await build("draft-a", "job-2", job(1, source, "change"));
  assert.deepEqual(changed.at(-1), {
    deleted: [],
    files: {
      "game.js": "// built",
      "game.ts": "let speed = 2;\nfunction gameRender() {}\n",
    },
    summary: "Made it faster.",
    type: "done",
  });

  // A re-POST while the job runs (the Talker restarted mid-build) attaches to it: both streams end with the same
  // `done`, and the box was restored for one job, not two.
  const before = await restores("draft-a");
  const first = await post("draft-a", "job-3", job(1, source, "wait"));
  await until("the playtest", () =>
    first.events.some((event) => event.type === "playtest")
  );
  const second = await post("draft-a", "job-3", job(1, source, "wait"));
  await coder("draft-a", "/fake/release", { method: "POST" });
  const [a, b] = await Promise.all([first.done, second.done]);
  assert.equal(a.at(-1).summary, "Built it after a wait.");
  assert.deepEqual(b.at(-1), a.at(-1));
  assert.equal(await restores("draft-a"), before + 1);
});

test("a job whose server is killed mid-build ends on its own; a re-POST gets its final event; the box is kept, then destroyed", async (t) => {
  t.after(kill);
  t.after(() => {
    if (!t.passed) {
      process.stdout.write(Buffer.concat(serverLog));
    }
  });
  await start();

  // Killed while the model answers its last step, after a green playtest.
  const first = await post("draft-r", "job-r", job(0, {}, "slow"));
  await until("the playtest", () =>
    first.events.some((event) => event.type === "playtest")
  );
  const before = await boxLog("draft-r");
  assert.ok(!before.includes("inactivity timeout"));
  kill();
  await first.done.catch(() => {});
  assert.ok(!first.events.some((event) => event.type === "done"));

  // Back up, and no request: pi-durable's heartbeat restarts the Coder, which finishes the job by itself and sets the
  // running box's inactivity timeout again.
  const from = Buffer.concat(serverLog).length;
  await start();
  await until(
    "the job's end with no request",
    () =>
      Buffer.concat(serverLog)
        .subarray(from)
        .toString()
        .includes("Coder draft-r: job job-r done"),
    60_000
  );
  const log = await boxLog("draft-r");
  assert.ok(log.includes("inactivity timeout"));

  // A re-POST of the finished job gets its final event at once, without building again.
  const again = await build("draft-r", "job-r", job(0, {}, "slow"));
  assert.equal(again.length, 1);
  assert.deepEqual(
    { ...again[0], files: Object.keys(again[0].files).toSorted() },
    {
      deleted: [],
      files: ["game.js", "game.ts", "index.html"],
      summary: "Built it after a restart.",
      type: "done",
    }
  );
  assert.deepEqual(await boxLog("draft-r"), log);

  // DELETE /box (a Draft deleted) destroys the box; the next job cold-starts one.
  const deleted = await coder("draft-r", "/box", { method: "DELETE" });
  assert.equal(deleted.status, 204);
  const destroyed = await boxLog("draft-r");
  assert.equal(destroyed.at(-1), "destroy");
  const next = await build("draft-r", "job-s", job(0, {}, "new"));
  assert.equal(next.at(-1).type, "done");
  const after = await boxLog("draft-r");
  assert.deepEqual(
    after.filter((c) => c === "start" || c === "destroy"),
    ["start", "destroy", "start"]
  );
});
