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
// The local D1's rows for `sql`.
const d1 = async (sql) => {
  const execute = spawn(
    "npx",
    [
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--local",
      "--persist-to",
      state,
      "--config",
      CONFIG,
      "--json",
      "--command",
      sql,
    ],
    { cwd: API, stdio: ["ignore", "pipe", "inherit"] }
  );
  const chunks = [];
  execute.stdout.on("data", (data) => chunks.push(data));
  const [code] = await once(execute, "exit");
  assert.equal(code, 0);
  const [{ results }] = JSON.parse(Buffer.concat(chunks).toString());
  return results;
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
  const migrate = spawn(
    "npx",
    [
      "wrangler",
      "d1",
      "migrations",
      "apply",
      "DB",
      "--local",
      "--persist-to",
      state,
      "--config",
      CONFIG,
    ],
    { cwd: API, stdio: "ignore" }
  );
  const [code] = await once(migrate, "exit");
  assert.equal(code, 0);
  await d1("INSERT INTO drafts (id, owner) VALUES ('draft-a', 'user_coder')");
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
  // Its 3 model calls are charged to the Draft's owner: 1 input and 1 output token each, $0.0000006 at Haiku 5.5's
  // prices, is 6 hopon tokens.
  const charged = await d1("SELECT bucket, count FROM generation_limits");
  assert.equal(charged.length, 1);
  assert.match(charged[0].bucket, /^user_coder:\d{4}-W\d{2}$/u);
  assert.equal(charged[0].count, 18);

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

test(
  "music ends done with music.js; the deadline, the 13th step and cancel end failed; no box ends busy",
  { timeout: 60_000 },
  async (t) => {
    t.after(kill);
    t.after(() => {
      if (!t.passed) {
        process.stdout.write(Buffer.concat(serverLog));
      }
    });
    await start();
    const withMusic = (brief) => {
      const plain = job(0, {}, brief);
      return { ...plain, spec: { ...plain.spec, music: "chiptune" } };
    };
    const [music, late, lateMusic, steps, busy] = await Promise.all([
      build("draft-music", "job-1", withMusic("music")),
      // The "late" brief's deadline is 1 s (test/coder/worker.ts); its reason names the real one.
      build("draft-late", "job-1", job(0, {}, "late")),
      build("draft-late-music", "job-1", withMusic("late")),
      build("draft-loop", "job-1", job(0, {}, "loop")),
      build("nobox-1", "job-1", job(0, {}, "new")),
    ]);
    const cancelled = await post("draft-cancel", "job-1", job(0, {}, "cancel"));

    // Music: written and rendered in the run, ending in music.js, which index.html loads.
    assert.deepEqual(
      music.slice(0, -1).map((event) => event.label ?? event.type),
      [
        "Writing the game",
        "Writing the game",
        "Writing music",
        "Playtesting",
        "playtest",
      ]
    );
    const done = music.at(-1);
    assert.equal(done.type, "done");
    assert.equal(done.summary, "Built it with music.");
    assert.deepEqual(Object.keys(done.files).toSorted(), [
      "game.js",
      "game.ts",
      "index.html",
      "music.js",
      "music.mjs",
    ]);
    // test/coder/worker.ts's music.opus, in base64.
    assert.equal(done.files["music.js"], 'hopon.music = "T2dnUw==";\n');
    assert.match(done.files["index.html"], /music\.js/u);

    // 120 s, or 150 s with music.
    assert.deepEqual(late, [
      { reason: "past the 120 s deadline", type: "failed" },
    ]);
    assert.deepEqual(lateMusic, [
      { reason: "past the 150 s deadline", type: "failed" },
    ]);

    // Twelve steps run; the 13th is blocked and ends the job.
    assert.deepEqual(steps, [
      ...Array.from({ length: 12 }, () => ({
        label: "Writing the game",
        type: "step",
      })),
      { reason: "over 12 steps", type: "failed" },
    ]);

    // A box that can't start built nothing and made no model call: `busy`.
    assert.deepEqual(busy, [{ reason: "busy", type: "failed" }]);

    // Cancel stops the running command and ends the job.
    await until("the command", () => cancelled.events.length > 0);
    const response = await coder("draft-cancel", "/jobs/job-1/cancel", {
      method: "POST",
    });
    assert.equal(response.status, 204);
    assert.deepEqual(await cancelled.done, [
      { label: "Writing the game", type: "step" },
      { reason: "cancelled", type: "failed" },
    ]);

    // Every command the box ran was under `timeout --kill-after=5`, so an abort stops all it started.
    for (const draft of ["draft-music", "draft-cancel", "draft-loop"]) {
      // oxlint-disable-next-line no-await-in-loop -- one Draft at a time
      const log = await boxLog(draft);
      // The rest are the box's own start, destroy and inactivity timeout.
      const commands = log.filter(
        (entry) => !["start", "destroy", "inactivity timeout"].includes(entry)
      );
      assert.ok(commands.length > 0);
      for (const command of commands) {
        assert.match(command, /^timeout --kill-after=5 \d+ /u);
      }
    }
  }
);

test("a job whose server is killed mid-build ends on its own, on its box or on a fresh one from its source; a re-POST gets its final event; the box is kept, then destroyed", async (t) => {
  t.after(kill);
  t.after(() => {
    if (!t.passed) {
      process.stdout.write(Buffer.concat(serverLog));
    }
  });
  await start();

  // Killed while the model answers its last step, after a green playtest. lost-r's box stops with the server.
  const lostSource = { "game.ts": "let speed = 3;\n" };
  const first = await post("draft-r", "job-r", job(0, {}, "slow"));
  const lost = await post("lost-r", "job-r", job(1, lostSource, "slow"));
  for (const { events } of [first, lost]) {
    // oxlint-disable-next-line no-await-in-loop -- one Draft at a time
    await until("the playtest", () =>
      events.some((event) => event.type === "playtest")
    );
  }
  const before = await boxLog("draft-r");
  assert.ok(!before.includes("inactivity timeout"));
  const { length: lostBefore } = await boxLog("lost-r");
  kill();
  await Promise.all(
    [first.done, lost.done].map((done) => done.catch(() => {}))
  );
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

  // lost-r's job ends on a fresh box, started again and given the job's source: what the old box held is gone.
  await until(
    "lost-r's end with no request",
    () =>
      Buffer.concat(serverLog)
        .subarray(from)
        .toString()
        .includes("Coder lost-r: job job-r done"),
    60_000
  );
  const lostAll = await boxLog("lost-r");
  const lostLog = lostAll.slice(lostBefore);
  assert.equal(lostLog[0], "start");
  assert.match(lostLog[1], /find \/workspace -mindepth 1 -delete/u);
  const [lostDone] = await build("lost-r", "job-r", job(1, lostSource, "slow"));
  assert.equal(lostDone.type, "done");
  assert.deepEqual(lostDone.deleted, []);
  assert.equal(lostDone.files["game.ts"], undefined);
  assert.equal(lostDone.files["game.js"], undefined);

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
