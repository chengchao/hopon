// The Maker (ADR 0005) under `wrangler dev`, through the Worker's routes and a WebSocket, as the app sees it: the main
// agent's `build` (#143) and the sub agent's job (#175). test/maker/worker.ts fakes the model (a message
// "build <script>" builds with that script) and the sandbox, so this needs no key, no Docker and no model call. The
// sandbox's commands are read back through the fake.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { STATUS_MARK } from "@hopon/schemas";

const API = new URL("..", import.meta.url).pathname;
const CONFIG = new URL("maker/wrangler.jsonc", import.meta.url).pathname;
const state = mkdtempSync(path.join(tmpdir(), "maker-test-"));
// test/maker/worker.ts's game.ts.
const GAME = "let speed = 1;\nfunction gameRender() {}\n";

const keys = await crypto.subtle.generateKey(
  {
    hash: "SHA-256",
    modulusLength: 2048,
    name: "RSASSA-PKCS1-v1_5",
    publicExponent: new Uint8Array([1, 0, 1]),
  },
  true,
  ["sign", "verify"]
);
const pem = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(await crypto.subtle.exportKey("spki", keys.publicKey)).toString("base64")}\n-----END PUBLIC KEY-----`;
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = async (sub) => {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ exp: now + 600, iat: now, nbf: now, sub, username: "maker" })}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keys.privateKey,
    new TextEncoder().encode(body)
  );
  return `${body}.${Buffer.from(signature).toString("base64url")}`;
};
const vars = path.join(state, "vars.env");
writeFileSync(
  vars,
  `CLERK_JWT_KEY="${pem}"\nPREVIEW_SECRET="test-preview-secret-of-32-chars!!"\n`
);

const wrangler = (args, options) =>
  spawn("npx", ["wrangler", ...args, "--config", CONFIG], {
    cwd: API,
    ...options,
  });
const freePort = async () => {
  const server = createServer().listen(0);
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  return port;
};
const port = await freePort();
const ORIGIN = `http://127.0.0.1:${port}`;

let server;
// The server's output, printed only if the test fails.
const serverLog = [];
const start = async () => {
  server = wrangler(
    [
      "dev",
      "--local",
      "--port",
      `${port}`,
      "--persist-to",
      state,
      "--env-file",
      vars,
    ],
    { detached: true, stdio: ["ignore", "pipe", "pipe"] }
  );
  server.stdout.on("data", (data) => serverLog.push(data));
  server.stderr.on("data", (data) => serverLog.push(data));
  for (;;) {
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

// A signed-in request: a POST with `body`, otherwise a GET.
const call = async (route, body) => {
  const init = {
    headers: {
      Authorization: `Bearer ${await token("user_maker")}`,
      "Content-Type": "application/json",
    },
  };
  const response = await fetch(
    `${ORIGIN}${route}`,
    body === undefined
      ? init
      : { ...init, body: JSON.stringify(body), method: "POST" }
  );
  assert.ok(response.status < 500, `${route}: ${response.status}`);
  return response;
};
const json = async (route, body) => {
  const response = await call(route, body);
  return response.json();
};
const send = (draft, text) => json(`/api/drafts/${draft}/messages`, { text });
const ended = (frame) =>
  frame.type === "turn_done" || frame.type === "turn_failed";
// A turn's end, or a snapshot taken after it.
const over = (frame) =>
  frame.type === "turn_done" ||
  (frame.type === "snapshot" &&
    !frame.data.run &&
    frame.data.entries.at(-1)?.kind === "pi.assistant");
const stepLabel = (frame) => JSON.stringify(frame).includes("Writing the game");
const steered = (frame) => JSON.stringify(frame).includes("inbox_update");

// One socket to the Draft's Maker and every frame it gets.
const connect = async (draft) => {
  const { ticket } = await json(`/api/drafts/${draft}/ws-ticket`, {});
  const socket = new WebSocket(
    `ws${ORIGIN.slice(4)}/api/drafts/${draft}/ws?ticket=${ticket}`
  );
  const frames = [];
  socket.addEventListener("message", ({ data }) => {
    frames.push(JSON.parse(data));
  });
  const until = async (what, check) => {
    const deadline = Date.now() + 60_000;
    for (;;) {
      const found = frames.find(check);
      if (found) {
        return found;
      }
      assert.ok(
        Date.now() < deadline,
        `timed out waiting for ${what}; the last frames: ${JSON.stringify(frames.slice(-5)).slice(-4000)}`
      );
      // oxlint-disable-next-line no-await-in-loop -- polling
      await sleep(50);
    }
  };
  await until("the snapshot", (frame) => frame.type === "snapshot");
  // A wait for the first frame from now on that passes `check`.
  const after = (what, check) => {
    const from = frames.length;
    return () => until(what, (frame, index) => index >= from && check(frame));
  };
  return {
    after,
    close: () => socket.close(),
    frames,
    // Sends `text`, then the outcome of the turn it starts: turn_done or turn_failed. They carry pi's submission id,
    // not the id the POST returns, so they're matched by order.
    turn: async (text) => {
      const outcome = after(`the end of "${text}"`, ended);
      await send(draft, text);
      const frame = await outcome();
      return frame.type;
    },
    until,
  };
};

// The main agent's transcript, from a fresh snapshot: each entry's kind and text.
const transcript = async (draft) => {
  const socket = await connect(draft);
  socket.close();
  const [{ data }] = socket.frames;
  return data.entries.map((entry) => ({
    kind: entry.kind,
    text: (entry.model ?? [])
      .flatMap((message) =>
        typeof message.content === "string"
          ? [message.content]
          : message.content.flatMap((block) =>
              block.type === "text" ? [block.text] : []
            )
      )
      .join(" "),
  }));
};
const lastReply = async (draft) => {
  const entries = await transcript(draft);
  return entries.findLast((entry) => entry.kind === "pi.assistant")?.text;
};
// The Draft's Maker through MAKER_DEV's route, for test/maker/worker.ts's fakes.
const fake = (draft, what) => fetch(`${ORIGIN}/__maker/${draft}/fake/${what}`);
const fakeJson = async (draft, what) => {
  const response = await fake(draft, what);
  return response.json();
};
const subCalls = (draft) => fakeJson(draft, "calls");
const boxLog = (draft) => fakeJson(draft, "log");
const playtests = async (draft) => {
  const log = await boxLog(draft);
  return log.filter((c) => c.includes("/opt/hopon/playtest.js")).length;
};
const previewUrl = async (draft) => {
  const { url } = await json(`/api/drafts/${draft}/preview`);
  return url;
};
// A file of the current Revision, through the app's preview link: [n, status, text].
const revisionFile = async (draft, file) => {
  const url = await previewUrl(draft);
  const page = await fetch(url.replace(/index\.html$/u, file));
  return [
    Number(new URL(url).pathname.split("/")[3]),
    page.status,
    await page.text(),
  ];
};
// The current Revision's number.
const revisionOf = async (draft) => {
  const [n] = await revisionFile(draft, "game.ts");
  return n;
};

const migrate = async () => {
  const migrating = wrangler(
    ["d1", "migrations", "apply", "DB", "--local", "--persist-to", state],
    { stdio: "ignore" }
  );
  const [code] = await once(migrating, "exit");
  assert.equal(code, 0);
};
const serve = async (t) => {
  await start();
  t.after(kill);
  t.after(() => {
    if (!t.passed) {
      process.stdout.write(Buffer.concat(serverLog));
    }
  });
};
// The server's output from `from` on contains `line`: a job pi finished with nobody connected.
const logged = async (from, line) => {
  const deadline = Date.now() + 60_000;
  while (!Buffer.concat(serverLog).subarray(from).toString().includes(line)) {
    assert.ok(Date.now() < deadline, `timed out waiting for "${line}"`);
    // oxlint-disable-next-line no-await-in-loop -- polling
    await sleep(100);
  }
};

test(
  "build: the sub agent makes and changes the game as Revisions in R2; failures, Stop, the timer, a steer and a restart",
  { timeout: 180_000 },
  async (t) => {
    await migrate();
    await serve(t);

    // A new Draft's first build, with music, writes 1/; the D1 row gets the title.
    const { id: draft } = await json("/api/drafts", { text: "build music" });
    let socket = await connect(draft);
    // The fakes are quick, so the first turn may be over before the socket's snapshot.
    await socket.until("the first turn's end", over);
    assert.deepEqual(await revisionFile(draft, "game.ts"), [1, 200, GAME]);
    assert.deepEqual(await revisionFile(draft, "game.js"), [
      1,
      200,
      "// built",
    ]);
    const [indexAt, , index] = await revisionFile(draft, "index.html");
    assert.equal(indexAt, 1);
    assert.match(index, /<script src="game\.js"><\/script>/u);
    assert.match(index, /music\.js/u);
    // test/maker/worker.ts's music.opus, in base64.
    assert.deepEqual(await revisionFile(draft, "music.js"), [
      1,
      200,
      'hopon.music = "T2dnUw==";\n',
    ]);
    // Gzipped by the runtime (workerd), from the Worker's Content-Encoding; fetch decodes it, so the text above held.
    const page = await previewUrl(draft);
    const gzipped = await fetch(page.replace(/index\.html$/u, "music.js"), {
      headers: { "Accept-Encoding": "gzip" },
    });
    assert.equal(gzipped.headers.get("Content-Encoding"), "gzip");
    assert.equal(await gzipped.text(), 'hopon.music = "T2dnUw==";\n');
    const { drafts } = await json("/api/drafts");
    assert.equal(drafts[0].title, "Moon Cat");
    assert.equal(await lastReply(draft), "said: Built it with music.");

    // A change: the sub agent edits the source it was given and plays it again; 2/ carries the music over, and 1/ is
    // gone.
    const first = await previewUrl(draft);
    assert.equal(await socket.turn("build change"), "turn_done");
    assert.deepEqual(await revisionFile(draft, "game.ts"), [
      2,
      200,
      "let speed = 2;\nfunction gameRender() {}\n",
    ]);
    assert.deepEqual(await revisionFile(draft, "game.js"), [
      2,
      200,
      "// built",
    ]);
    assert.deepEqual(await revisionFile(draft, "music.js"), [
      2,
      200,
      'hopon.music = "T2dnUw==";\n',
    ]);
    const gone = await fetch(first);
    assert.equal(gone.status, 404);

    // The harness check runs what ships, a change after the last green playtest included. A break after it fails the
    // check, whose errors go back to the sub agent 3 times; then the build fails and leaves the Revision alone.
    const before = await playtests(draft);
    assert.equal(await socket.turn("build editLate"), "turn_done");
    assert.deepEqual(await revisionFile(draft, "game.js"), [
      3,
      200,
      "// built 3",
    ]);
    assert.equal(await playtests(draft), before + 2);
    const calls = await subCalls(draft);
    assert.equal(await socket.turn("build breakLate"), "turn_done");
    assert.match(
      await lastReply(draft),
      /The build failed: the harness check failed: boom/u
    );
    assert.equal((await subCalls(draft)) - calls, 4 + 3);
    assert.equal(await revisionOf(draft), 3);

    // A box that can't start: busy has its own line, and the sub agent made no model call.
    const called = await subCalls(draft);
    await fake(draft, "nobox");
    await socket.turn("build new");
    assert.match(
      await lastReply(draft),
      /The Maker is busy\. Try again in a minute\./u
    );
    assert.equal(await subCalls(draft), called);

    // A job that never ends: the abort timer ends the turn turn_failed, and the running command is stopped.
    assert.equal(await socket.turn("build hang"), "turn_failed");
    assert.equal(await revisionOf(draft), 3);

    // Stop mid-build, once the sub agent's step label reached the socket: turn_failed; the game hasn't changed.
    let step = socket.after("the step label", stepLabel);
    const stopped = socket.turn("build wait");
    await step();
    // Publish waits for the turn to end (#145).
    const publishing = await call(`/api/drafts/${draft}/publish`, {});
    assert.equal(publishing.status, 409);
    await call(`/api/drafts/${draft}/stop`, {});
    assert.equal(await stopped, "turn_failed");
    assert.equal(await revisionOf(draft), 3);

    // A steer sent mid-build reaches the main agent after build returns.
    step = socket.after("the step label", stepLabel);
    const building = socket.turn("build wait");
    await step();
    const queued = socket.after("the queued steer", steered);
    await send(draft, "make it orange");
    await queued();
    await fake(draft, "release");
    assert.equal(await building, "turn_done");
    const entries = await transcript(draft);
    const result = entries.findLastIndex(
      (entry) => entry.text === "Built it after a wait."
    );
    const steer = entries.findLastIndex(
      (entry) => entry.text === "make it orange"
    );
    assert.ok(
      result !== -1 && result < steer,
      JSON.stringify(entries.slice(-4))
    );
    assert.match(entries.at(-1).text, /make it orange/u);
    assert.equal(await revisionOf(draft), 4);

    // Killed while the sub agent's model answers its last step: the app reconnects, pi resumes the build and the same
    // job, the box keeps running and gets its inactivity timeout again, and the Revision is written.
    step = socket.after("the step label", stepLabel);
    await send(draft, "build slow");
    await step();
    socket.close();
    kill();
    let from = Buffer.concat(serverLog).length;
    await start();
    socket = await connect(draft);
    await logged(from, `Maker ${draft}: job slow done`);
    await socket.until("the turn's end after the restart", over);
    assert.equal(await revisionOf(draft), 5);
    const kept = await boxLog(draft);
    assert.ok(kept.includes("inactivity timeout"));

    // Again on a box that stops with the server: a fresh one starts and gets the job's source. What the sub agent wrote
    // went with the old box, so the harness check tells it to write it again before it plays anything.
    await fake(draft, "lose");
    const { length: lostBefore } = await boxLog(draft);
    step = socket.after("the step label", stepLabel);
    await send(draft, "build slow");
    await step();
    socket.close();
    kill();
    from = Buffer.concat(serverLog).length;
    await start();
    socket = await connect(draft);
    await logged(from, `Maker ${draft}: job slow done`);
    await socket.until("the turn's end after the second restart", over);
    const all = await boxLog(draft);
    const lost = all.slice(lostBefore);
    const restarted = lost.lastIndexOf("start");
    assert.ok(restarted > 0, JSON.stringify(lost));
    assert.match(
      lost[restarted + 1],
      /\/usr\/bin\/find \/workspace \/home\/user -mindepth 1 -delete/u
    );
    assert.equal(await lastReply(draft), "said: Wrote it again.");
    assert.deepEqual(await revisionFile(draft, "game.ts"), [6, 200, GAME]);

    // A start over: the sub agent is asked for a new game in an empty workspace, and 7/ carries nothing of 6/.
    const [, musicBefore] = await revisionFile(draft, "music.mjs");
    assert.equal(musicBefore, 200);
    assert.equal(await socket.turn("build fresh"), "turn_done");
    assert.equal(await lastReply(draft), "said: Build a new game.");
    assert.deepEqual(await revisionFile(draft, "game.ts"), [7, 200, GAME]);
    const [, musicAfter] = await revisionFile(draft, "music.mjs");
    assert.equal(musicAfter, 404);

    // Every command the box ran was under `timeout --kill-after=5`, so an abort stops all it started. The harness's own
    // (the playtest, the sweep) name the program by its full path, with no shell to run a model's ~/.bash_profile.
    const log = await boxLog(draft);
    const commands = log.filter(
      (entry) => !["start", "destroy", "inactivity timeout"].includes(entry)
    );
    assert.ok(commands.length > 0);
    for (const command of commands) {
      assert.match(command, /^\/usr\/bin\/timeout --kill-after=5 \d+ /u);
    }
    const harness = commands.filter((command) =>
      /playtest\.js|\/usr\/bin\/find/u.test(command)
    );
    assert.ok(harness.length > 0);
    for (const command of harness) {
      assert.match(command, /^\/usr\/bin\/timeout --kill-after=5 \d+ \/usr\//u);
    }

    // Between turns, Publish turns the last Revision into a Game with the Maker's title and description, and the Draft
    // goes, with its box.
    const published = await call(`/api/drafts/${draft}/publish`, {});
    assert.equal(published.status, 201);
    const { id: gameId } = await published.json();
    const { games } = await json("/api/games");
    assert.deepEqual(
      { ...games[0], comments: undefined, likes: undefined },
      {
        author: "maker",
        comments: undefined,
        description: "Tap to jump from moon to moon.",
        id: gameId,
        liked: false,
        likes: undefined,
        mine: true,
        saved: false,
        title: "Moon Cat",
      }
    );
    const game = await fetch(`${ORIGIN}/games/${gameId}/game.ts`);
    assert.equal(await game.text(), GAME);
    assert.deepEqual(await json("/api/drafts"), { drafts: [] });
    socket.close();

    // Every model call was tagged with the agent that made it.
    assert.equal(await fakeJson(draft, "mistagged"), 0);

    // A second build in one turn is refused, even in a later tool round, and the next turn can build.
    const { id: twice } = await json("/api/drafts", { text: "build twice" });
    socket = await connect(twice);
    await socket.until("the two-build turn's end", over);
    const [afterTwo] = await revisionFile(twice, "game.ts");
    assert.equal(afterTwo, 1);
    assert.match(await lastReply(twice), /Only one build per message/u);
    assert.equal(await socket.turn("build new"), "turn_done");
    const [nextTurn] = await revisionFile(twice, "game.ts");
    assert.equal(nextTurn, 2);

    // Delete takes the box with the Draft, before the Maker's storage goes.
    const deleted = await fetch(`${ORIGIN}/api/drafts/${twice}`, {
      headers: { Authorization: `Bearer ${await token("user_maker")}` },
      method: "DELETE",
    });
    assert.equal(deleted.status, 204);
    assert.equal(await fakeJson(twice, "destroyed"), true);
    assert.deepEqual(await boxLog(twice), []);
    socket.close();
  }
);

test(
  "harness check: a game green under its own playtest and red under the check goes back to the sub agent, which fixes it",
  { timeout: 60_000 },
  async (t) => {
    await serve(t);
    const { id: draft } = await json("/api/drafts", { text: "build crashy" });
    const socket = await connect(draft);
    await socket.until("the crashy turn's end", over);
    assert.equal(await lastReply(draft), "said: Fixed it.");
    assert.deepEqual(await revisionFile(draft, "game.ts"), [1, 200, GAME]);
    assert.deepEqual(await fakeJson(draft, "told"), [
      "The harness ran your game and it failed:\n- boom\nFix these, playtest again, then give your report.",
    ]);
    socket.close();
  }
);

test(
  "report: the sub agent's reports reach the socket marked as statuses, and none is a step",
  { timeout: 120_000 },
  async (t) => {
    await serve(t);
    const { id: draft } = await json("/api/drafts", { text: "build reported" });
    const socket = await connect(draft);
    await socket.until("a report", (frame) =>
      JSON.stringify(frame).includes(`${STATUS_MARK}Drawing the moon 24`)
    );
    await socket.until("the turn's end", over);
    assert.match(await lastReply(draft), /Built it\./u);
    socket.close();
  }
);

test(
  "limits: the deadline and the 21st step end the job failed, and nothing is written",
  { timeout: 120_000 },
  async (t) => {
    await serve(t);
    const { id: draft } = await json("/api/drafts", { text: "build late" });
    const socket = await connect(draft);
    await socket.until("the late turn's end", over);
    // 300 s; the fake's is 1 s.
    assert.match(
      await lastReply(draft),
      /The build failed: past the 300 s deadline/u
    );
    // Twenty steps run; the 21st is blocked and ends the job.
    const calls = await subCalls(draft);
    assert.equal(await socket.turn("build loop"), "turn_done");
    assert.match(await lastReply(draft), /The build failed: over 20 steps/u);
    assert.equal((await subCalls(draft)) - calls, 21);
    // None of them made a Revision.
    const preview = await call(`/api/drafts/${draft}/preview`);
    assert.equal(preview.status, 404);
    socket.close();
  }
);

test(
  "races: Stop, the timer, Delete and restarts each end only their own job",
  { timeout: 240_000 },
  async (t) => {
    await migrate();
    await serve(t);
    const { id: draft } = await json("/api/drafts", { text: "build new" });
    let socket = await connect(draft);
    await socket.until("the first turn's end", over);

    // Stop while the stopped job's ending is slow, then build at once: the new job runs as if alone, and fails at its
    // own deadline.
    let step = socket.after("the step label", stepLabel);
    let stopped = socket.turn("build wait");
    await step();
    await fake(draft, "slowreads/300");
    await call(`/api/drafts/${draft}/stop`, {});
    assert.equal(await stopped, "turn_failed");
    assert.equal(await socket.turn("build change"), "turn_done");
    assert.equal(await lastReply(draft), "said: Made it faster.");
    assert.equal(await revisionOf(draft), 2);
    step = socket.after("the step label", stepLabel);
    stopped = socket.turn("build wait");
    await step();
    await call(`/api/drafts/${draft}/stop`, {});
    assert.equal(await stopped, "turn_failed");
    assert.equal(await socket.turn("build late"), "turn_done");
    assert.match(
      await lastReply(draft),
      /The build failed: past the 300 s deadline/u
    );
    await fake(draft, "slowreads/0");

    // Stop during a playtest that would run 20 s: the playtest is aborted, and the turn ends at once.
    await fake(draft, "slowplay/20000");
    step = socket.after("the step label", stepLabel);
    stopped = socket.turn("build new");
    await step();
    await sleep(300);
    const at = Date.now();
    await call(`/api/drafts/${draft}/stop`, {});
    assert.equal(await stopped, "turn_failed");
    assert.ok(Date.now() - at < 3000, `Stop took ${Date.now() - at} ms`);

    // The box stops after the green playtest: what the sub agent wrote went with it, so the harness check tells it to
    // write it again, and the Revision holds what it played then.
    step = socket.after("the step label", stepLabel);
    const held = socket.turn("build wait");
    await step();
    await sleep(300);
    await fake(draft, "stopbox");
    await fake(draft, "release");
    assert.equal(await held, "turn_done");
    assert.equal(await lastReply(draft), "said: Wrote it again.");
    assert.equal(await revisionOf(draft), 3);

    // A reset after the job's state is written and before its prompt is submitted: the rerun submits it.
    socket.close();
    const from = Buffer.concat(serverLog).length;
    await send(draft, "build crashset");
    await logged(from, "reset before the submit");
    await sleep(1000);
    socket = await connect(draft);
    await logged(from, `Maker ${draft}: job crashset done`);
    await socket.until("the turn's end after the reset", over);
    assert.equal(await revisionOf(draft), 4);

    // Every model call was tagged with the agent that made it.
    assert.equal(await fakeJson(draft, "mistagged"), 0);

    // Delete during a slow playtest: it answers at once, and the box never starts again.
    await fake(draft, "slowplay/20000");
    step = socket.after("the step label", stepLabel);
    const deleting = socket.turn("build new");
    await step();
    await sleep(300);
    const before = Date.now();
    const deleted = await fetch(`${ORIGIN}/api/drafts/${draft}`, {
      headers: { Authorization: `Bearer ${await token("user_maker")}` },
      method: "DELETE",
    });
    assert.equal(deleted.status, 204);
    assert.ok(
      Date.now() - before < 3000,
      `Delete took ${Date.now() - before} ms`
    );
    deleting.catch(() => {});
    socket.close();
    await sleep(3000);
    assert.equal(await fakeJson(draft, "startsafterdestroy"), 0);
  }
);

// A message the Allowance refuses before any model call.
const refused = async (route, text) => {
  const response = await call(route, { text });
  assert.equal(response.status, 429);
  const { code } = await response.json();
  assert.equal(code, "allowance_used");
};

// The Allowance (ADR 0004) is 100,000 hopon tokens here (test/maker/wrangler.jsonc), and each fake main agent call
// reads 1,000 input tokens unless told to spend more, so its calls are 1,000 hopon tokens each; the sub agent's are 6.
test("allowance: each model call is charged to its Creator's week; a build starts only above zero, and one that starts finishes below it; then the Maker refuses until the week resets", async (t) => {
  await serve(t);
  const left = async () => {
    const { left: tokens } = await json("/api/allowance");
    return tokens;
  };
  // One chat turn, one model call: 1,000 input tokens at $0.10 a million is $0.0001, × 10,000,000.
  const before = await left();
  const { id: draft } = await json("/api/drafts", { text: "hello" });
  const socket = await connect(draft);
  await socket.until("the first turn's end", over);
  assert.equal(await left(), before - 1000);

  // Out of AI Gateway credits, the Maker is resting, and the refused call costs nothing.
  const resting = socket.after("the resting turn's end", ended);
  await send(draft, "no credits");
  const { reason } = await resting();
  assert.equal(reason, "resting");
  assert.equal(await left(), before - 1000);

  // 1,000 left: the build's turn takes it to zero before build runs, so the build is refused without the sub agent,
  // and the reply after it overshoots.
  await socket.turn(`spend ${before - 2000}`);
  assert.equal(await left(), 1000);
  assert.equal(await socket.turn("build new"), "turn_done");
  assert.equal(await subCalls(draft), 0);
  assert.match(
    await lastReply(draft),
    /You've used this week's hopon tokens\. They come back when the week resets\./u
  );
  assert.equal(await left(), -1000);

  // At or below zero, chat and builds are refused before any model call: the transcript doesn't change.
  const entries = await transcript(draft);
  await refused(`/api/drafts/${draft}/messages`, "hello again");
  await refused(`/api/drafts/${draft}/messages`, "build new");
  await refused("/api/drafts", "build new");
  assert.deepEqual(await transcript(draft), entries);
  assert.equal(await subCalls(draft), 0);
  socket.close();

  // A new week: this one's bucket becomes last week's, and the Allowance is full again.
  kill();
  const moved = wrangler(
    [
      "d1",
      "execute",
      "DB",
      "--local",
      "--persist-to",
      state,
      "--command",
      "UPDATE generation_limits SET bucket = 'user_maker:2026-W01' WHERE bucket LIKE 'user_maker:%'",
    ],
    { stdio: "ignore" }
  );
  const [code] = await once(moved, "exit");
  assert.equal(code, 0);
  await start();
  assert.equal(await left(), 100_000);

  // 1,500 left: the build's first call leaves 500, so it starts, and it finishes though its reply overshoots. The sub
  // agent's 3 calls are 18 of it.
  const again = await connect(draft);
  await again.turn("spend 98500");
  assert.equal(await left(), 1500);
  const step = again.after("the step label", stepLabel);
  const building = again.turn("build wait");
  await step();
  await fake(draft, "release");
  assert.equal(await building, "turn_done");
  const [n] = await revisionFile(draft, "game.ts");
  assert.equal(n, 1);
  assert.equal(await left(), -518);
  again.close();
});
