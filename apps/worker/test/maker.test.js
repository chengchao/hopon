// The Maker (ADR 0006) under `wrangler dev`, through the Worker's routes and a WebSocket, as the app sees it: one
// agent that chats, writes the game in the box and publishes it with `build`. test/maker/worker.ts fakes the model (a
// message "build <script>" plays that script) and the sandbox, so this needs no key, no Docker and no model call. The
// sandbox's commands are read back through the fake. The Worker runs on workerd here, so what the runtime does to a
// response (its Content-Encoding) is tested here too.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { buffer } from "node:stream/consumers";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { gunzipSync } from "node:zlib";

import { FROZEN } from "../../maker/vendor/build.ts";

const API = new URL("..", import.meta.url).pathname;
const CONFIG = new URL("maker/wrangler.jsonc", import.meta.url).pathname;
const state = mkdtempSync(path.join(tmpdir(), "maker-test-"));
// test/maker/worker.ts's game.ts.
const GAME = "let speed = 1;\nfunction gameRender() {}\n";
// test/maker/worker.ts's music.opus.
const OPUS = "OggS";
const NOTE = "Note to self: the jump checks out.";
// test/maker/worker.ts's design.md and tests.json.
const DESIGN = "# Moon Cat design\n";
const TESTS = '{"expose": [], "tests": []}';
const RESTARTED = /The sandbox restarted/u;

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
const VARS = `CLERK_JWT_KEY="${pem}"\nPREVIEW_SECRET="test-preview-secret-of-32-chars!!"\n`;
const vars = path.join(state, "vars.env");
writeFileSync(vars, VARS);
// The same, with an advisor model pi-ai doesn't know.
const noAdvisorVars = path.join(state, "no-advisor.env");
writeFileSync(noAdvisorVars, `${VARS}MAKER_ADVISOR_MODEL="claude-nope-1"\n`);

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
const start = async (envFile = vars) => {
  server = wrangler(
    [
      "dev",
      "--local",
      "--port",
      `${port}`,
      "--persist-to",
      state,
      "--env-file",
      envFile,
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
// The playtest's result has reached the app.
const played = (frame) =>
  frame.type === "batch" &&
  frame.data.some(
    (event) =>
      event.type === "tool_execution_end" && event.toolName === "playtest"
  );
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

// The conversation as a fresh socket's snapshot shows it.
const snapshot = async (draft) => {
  const socket = await connect(draft);
  socket.close();
  const [{ data }] = socket.frames;
  return data;
};
const blocks = (entry) =>
  (entry.model ?? []).flatMap((message) =>
    typeof message.content === "string"
      ? [{ text: message.content, type: "text" }]
      : message.content
  );
// The transcript the app shows: each entry's kind and text.
const transcript = async (draft) => {
  const { entries } = await snapshot(draft);
  return entries.map((entry) => ({
    kind: entry.kind,
    text: blocks(entry)
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join(" "),
  }));
};
const lastReply = async (draft) => {
  const entries = await transcript(draft);
  return entries.findLast((entry) => entry.kind === "pi.assistant")?.text;
};
// The tools the agent called, by name, as the app's chat sees them.
const toolsCalled = async (draft) => {
  const { entries } = await snapshot(draft);
  return entries.flatMap((entry) =>
    blocks(entry).flatMap((block) =>
      block.type === "toolCall" ? [block.name] : []
    )
  );
};
// The Draft's Maker through MAKER_DEV's route, for test/maker/worker.ts's fakes.
const fake = (draft, what) => fetch(`${ORIGIN}/__maker/${draft}/fake/${what}`);
const fakeJson = async (draft, what) => {
  const response = await fake(draft, what);
  return response.json();
};
const modelCalls = (draft) => fakeJson(draft, "calls");
const boxLog = (draft) => fakeJson(draft, "log");
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
// A source file of the current Revision, from its source.tgz (the fake box's is JSON): [n, its text or undefined].
const sourceFile = async (draft, file) => {
  const [n, status, packed] = await revisionFile(draft, "source.tgz");
  assert.equal(status, 200);
  return [n, JSON.parse(packed)[file]];
};
// The current Revision's number.
const revisionOf = async (draft) => {
  const [n] = await revisionFile(draft, "index.html");
  return n;
};
const noRevision = async (draft) => {
  const preview = await call(`/api/drafts/${draft}/preview`);
  assert.equal(preview.status, 404);
};
const published = (n) => `said: Published: the Creator now has Revision ${n}.`;
// Whether the box's log has `build`'s verify run for a build of `kind`.
const verified = (log, kind) =>
  log.some((command) => command.endsWith(`/opt/hopon/verify.js ${kind}`));

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
const restart = async () => {
  kill();
  await start();
};
const deleteDraft = async (draft) =>
  fetch(`${ORIGIN}/api/drafts/${draft}`, {
    headers: { Authorization: `Bearer ${await token("user_maker")}` },
    method: "DELETE",
  });

test(
  "the Maker chats, and builds and changes the game as Revisions in R2; notes, failures, Stop, the timer, a steer and restarts",
  { timeout: 240_000 },
  async (t) => {
    await migrate();
    await serve(t);

    // A hello gets a reply and nothing else: no tool, so no skill and no build, and the box never starts.
    const { id: draft } = await json("/api/drafts", { text: "hello" });
    let socket = await connect(draft);
    // The fakes are quick, so the first turn may be over before the socket's snapshot.
    await socket.until("the hello's end", over);
    assert.equal(await lastReply(draft), "said: hello");
    assert.deepEqual(await toolsCalled(draft), []);
    assert.deepEqual(await boxLog(draft), []);
    assert.equal(await modelCalls(draft), 1);
    await noRevision(draft);

    // Before its first tool runs, the box holds everything the Creator has said in this chat.
    assert.equal(await socket.turn("build asked"), "turn_done");
    assert.match(await lastReply(draft), /"hello",\s*"build asked"/u);

    // A change needs a game to change: with no Revision, build refuses it, and nothing is written.
    assert.equal(await socket.turn("build change"), "turn_done");
    assert.match(await lastReply(draft), /There's no game yet/u);
    await noRevision(draft);

    // A new game with music writes 1/, and the D1 row gets the title.
    assert.equal(await socket.turn("build music"), "turn_done");
    assert.equal(await lastReply(draft), published(1));
    const called = await toolsCalled(draft);
    assert.ok(called.includes("build"));
    // The Revision is source.tgz and the built files: nothing of the source beside them.
    assert.deepEqual(await sourceFile(draft, "game.ts"), [1, GAME]);
    assert.deepEqual(await sourceFile(draft, "music.mjs"), [1, "// a track"]);
    const [, beside] = await revisionFile(draft, "game.ts");
    assert.equal(beside, 404);
    assert.deepEqual(await revisionFile(draft, "game.js"), [
      1,
      200,
      "// built",
    ]);
    const [indexAt, , index] = await revisionFile(draft, "index.html");
    assert.equal(indexAt, 1);
    assert.match(index, /data-music="music\.opus"/u);
    assert.deepEqual(await revisionFile(draft, "music.opus"), [1, 200, OPUS]);
    // The page fetches its music from an opaque origin; text is gzipped by the runtime (workerd), from the Worker's
    // Content-Encoding, and fetch decodes it, so the text above held.
    const page = await previewUrl(draft);
    const music = await fetch(page.replace(/index\.html$/u, "music.opus"), {
      headers: { "Accept-Encoding": "gzip" },
    });
    assert.equal(music.headers.get("Content-Type"), "audio/ogg");
    assert.equal(music.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(music.headers.get("Content-Encoding"), null);
    const gzipped = await fetch(page.replace(/index\.html$/u, "game.js"), {
      headers: { "Accept-Encoding": "gzip" },
    });
    assert.equal(gzipped.headers.get("Content-Encoding"), "gzip");
    assert.equal(await gzipped.text(), "// built");
    const { drafts } = await json("/api/drafts");
    assert.equal(drafts[0].title, "Moon Cat");

    // After a new game, what the Creator said for the games before it no longer counts for verify's quotes.
    assert.equal(await socket.turn("build asked"), "turn_done");
    assert.match(await lastReply(draft), /\["build asked"\]/u);

    // A change, in the workspace as the last run left it: 2/ keeps the score and its music, and 1/ is gone. Verify knows
    // the game had music.
    const first = await previewUrl(draft);
    assert.equal(await socket.turn("build change"), "turn_done");
    assert.ok(verified(await boxLog(draft), "change --had-music"));
    assert.deepEqual(await sourceFile(draft, "game.ts"), [
      2,
      "let speed = 2;\nfunction gameRender() {}\n",
    ]);
    assert.deepEqual(await sourceFile(draft, "music.mjs"), [2, "// a track"]);
    assert.deepEqual(await revisionFile(draft, "game.js"), [
      2,
      200,
      "// built",
    ]);
    assert.deepEqual(await revisionFile(draft, "music.opus"), [2, 200, OPUS]);
    const gone = await fetch(first);
    assert.equal(gone.status, 404);

    // A note the agent writes beside a tool call never reaches the app, streamed or whole; its reply does.
    const noted = socket.frames.length;
    assert.equal(await socket.turn("build noted"), "turn_done");
    assert.equal(await revisionOf(draft), 3);
    const live = JSON.stringify(socket.frames.slice(noted));
    assert.ok(!live.includes(NOTE), "the note reached the socket");
    assert.ok(live.includes(published(3)), "the reply reached the socket");
    assert.ok(!JSON.stringify(await snapshot(draft)).includes(NOTE));

    // A game the check fails: build's result is the errors, and the Revision stays.
    assert.equal(await socket.turn("build broken"), "turn_done");
    assert.match(await lastReply(draft), /The harness check failed:\s+- boom/u);
    assert.equal(await revisionOf(draft), 3);

    // A failed build, a fix, and 4/.
    assert.equal(await socket.turn("build fix"), "turn_done");
    assert.equal(await lastReply(draft), published(4));
    assert.deepEqual(await sourceFile(draft, "game.ts"), [4, GAME]);

    // A box that can't start: the agent is given the busy line, and nothing is written.
    await fake(draft, "nobox");
    assert.equal(await socket.turn("build one"), "turn_done");
    assert.match(
      await lastReply(draft),
      /The Maker is busy\. Try again in a minute\./u
    );
    assert.equal(await revisionOf(draft), 4);

    // A run that never ends: the abort timer ends the turn turn_failed, and the running command is stopped.
    assert.equal(await socket.turn("build hang"), "turn_failed");
    assert.equal(await revisionOf(draft), 4);

    // Stop mid-run: turn_failed, and the game hasn't changed.
    let step = socket.after("the playtest", played);
    const stopped = socket.turn("build wait");
    await step();
    // Publish waits for the turn to end (#145).
    const publishing = await call(`/api/drafts/${draft}/publish`, {});
    assert.equal(publishing.status, 409);
    await call(`/api/drafts/${draft}/stop`, {});
    assert.equal(await stopped, "turn_failed");
    assert.equal(await revisionOf(draft), 4);

    // A steer sent mid-run reaches the agent after the tool round it joins.
    step = socket.after("the playtest", played);
    const building = socket.turn("build wait");
    await step();
    const queued = socket.after("the queued steer", steered);
    await send(draft, "make it orange");
    await queued();
    await fake(draft, "release");
    assert.equal(await building, "turn_done");
    const entries = await transcript(draft);
    const result = entries.findLastIndex((entry) =>
      entry.text.includes("Revision 5")
    );
    const steer = entries.findLastIndex(
      (entry) => entry.text === "make it orange"
    );
    assert.ok(
      result !== -1 && result < steer,
      JSON.stringify(entries.slice(-4))
    );
    assert.equal(entries.at(-1).text, "said: make it orange");
    assert.deepEqual(await revisionFile(draft, "game.js"), [
      5,
      200,
      "// built 3",
    ]);

    // Killed while the model answers mid-run: the app reconnects, pi resumes the run, the box keeps running and gets
    // its inactivity timeout again, and the Revision is written.
    step = socket.after("the playtest", played);
    await send(draft, "build slow");
    await step();
    socket.close();
    await restart();
    socket = await connect(draft);
    await socket.until("the turn's end after the restart", over);
    assert.equal(await lastReply(draft), published(6));
    const kept = await boxLog(draft);
    assert.ok(kept.includes("inactivity timeout"));

    // Again on a box that stops with the server: a fresh one starts from the current Revision, and the agent is told
    // its work is gone instead of building what's left.
    await fake(draft, "lose");
    const { length: lostBefore } = await boxLog(draft);
    step = socket.after("the playtest", played);
    await send(draft, "build slow");
    await step();
    socket.close();
    await restart();
    socket = await connect(draft);
    await socket.until("the turn's end after the second restart", over);
    const all = await boxLog(draft);
    const lost = all.slice(lostBefore);
    const restarted = lost.lastIndexOf("start");
    assert.ok(restarted > 0, JSON.stringify(lost));
    assert.match(
      lost[restarted + 1],
      /\/usr\/bin\/find \/workspace \/home\/user -mindepth 1 -delete/u
    );
    assert.match(await lastReply(draft), RESTARTED);
    assert.equal(await revisionOf(draft), 6);

    // A start over: 7/ carries nothing of 6/.
    assert.deepEqual(await sourceFile(draft, "music.mjs"), [6, "// a track"]);
    assert.equal(await socket.turn("build fresh"), "turn_done");
    assert.equal(await lastReply(draft), published(7));
    const fresh = await revisionFile(draft, "source.tgz");
    assert.deepEqual(Object.keys(JSON.parse(fresh[2])), ["game.ts"]);
    const [, musicAfter] = await revisionFile(draft, "music.opus");
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
    const publish = await call(`/api/drafts/${draft}/publish`, {});
    assert.equal(publish.status, 201);
    const { id: gameId } = await publish.json();
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
    // The Game is what the page loads: the source stays with the Draft.
    const game = await fetch(`${ORIGIN}/games/${gameId}/game.js`);
    assert.equal(await game.text(), "// built");
    const source = await fetch(`${ORIGIN}/games/${gameId}/source.tgz`);
    assert.equal(source.status, 404);
    assert.deepEqual(await json("/api/drafts"), { drafts: [] });
    socket.close();

    // Every model call was tagged as the Maker's.
    assert.equal(await fakeJson(draft, "mistagged"), 0);

    // Delete takes the box with the Draft, before the Maker's storage goes.
    const { id: doomed } = await json("/api/drafts", { text: "build new" });
    socket = await connect(doomed);
    await socket.until("the build's end", over);
    assert.equal(await revisionOf(doomed), 1);
    const deleted = await deleteDraft(doomed);
    assert.equal(deleted.status, 204);
    assert.equal(await fakeJson(doomed, "destroyed"), true);
    assert.deepEqual(await boxLog(doomed), []);
    socket.close();
  }
);

test(
  "skills: the agent loads make-game, and reads an engine's guide from it through the real tools",
  { timeout: 120_000 },
  async (t) => {
    await serve(t);
    const { id: draft } = await json("/api/drafts", { text: "build guide" });
    const socket = await connect(draft);
    await socket.until("the guide turn's end", over);
    assert.deepEqual(await toolsCalled(draft), [
      "activate_skill",
      "read_skill_resource",
      "read_skill_resource",
    ]);
    const { entries } = await snapshot(draft);
    const results = entries
      .filter((entry) => entry.kind !== "pi.assistant")
      .flatMap((entry) =>
        blocks(entry).flatMap((block) =>
          block.type === "text" ? [block.text] : []
        )
      )
      .join("\n");
    // activate_skill's result lists each guide as a bundled file.
    for (const guide of [
      "phaser",
      "r3f",
      "react",
      "sound-effects",
      "music-synth",
      "music-sf2",
    ]) {
      assert.match(
        results,
        new RegExp(
          `<file kind="reference"[^>]*>references/${guide}\\.md</file>`,
          "u"
        )
      );
    }
    assert.match(results, /# Writing a hopon game in Phaser 4/u);
    assert.match(
      await lastReply(draft),
      /said: .*Skill resource not found: make-game\/references\/littlejs\.md/u
    );
    socket.close();
  }
);

test(
  "limits: the 21st step and the 5th build are refused, and the agent is told to give up",
  { timeout: 120_000 },
  async (t) => {
    await serve(t);
    const { id: draft } = await json("/api/drafts", { text: "build loop" });
    const socket = await connect(draft);
    await socket.until("the loop turn's end", over);
    assert.match(await lastReply(draft), /Over the 20-step limit/u);
    // 21 tool calls, then the reply.
    assert.equal(await modelCalls(draft), 22);
    await noRevision(draft);

    // Four builds publish; the fifth is refused.
    assert.equal(await socket.turn("build five"), "turn_done");
    assert.match(await lastReply(draft), /Over the 4-build limit/u);
    assert.equal(await revisionOf(draft), 4);
    socket.close();
  }
);

test(
  "races: Stop, a stopped box and Delete each end only their own run",
  { timeout: 120_000 },
  async (t) => {
    await serve(t);
    const { id: draft } = await json("/api/drafts", { text: "build new" });
    const socket = await connect(draft);
    await socket.until("the first turn's end", over);
    assert.equal(await revisionOf(draft), 1);

    // Stop during a playtest that would run 20 s: the playtest is aborted, and the turn ends at once.
    await fake(draft, "slowplay/20000");
    let step = socket.after("the playtest's call", (frame) =>
      JSON.stringify(frame).includes('"name":"playtest"')
    );
    const stopped = socket.turn("build new");
    await step();
    await sleep(300);
    const at = Date.now();
    await call(`/api/drafts/${draft}/stop`, {});
    assert.equal(await stopped, "turn_failed");
    assert.ok(Date.now() - at < 3000, `Stop took ${Date.now() - at} ms`);
    assert.equal(await revisionOf(draft), 1);

    // The box stops after the playtest: what the agent wrote went with it, so it's told so rather than building what's
    // left, and the Revision stays.
    step = socket.after("the playtest", played);
    const held = socket.turn("build wait");
    await step();
    await fake(draft, "stopbox");
    await fake(draft, "release");
    assert.equal(await held, "turn_done");
    assert.match(await lastReply(draft), RESTARTED);
    assert.equal(await revisionOf(draft), 1);

    assert.equal(await fakeJson(draft, "mistagged"), 0);

    // Delete during a slow playtest: it answers at once, and the box never starts again.
    await fake(draft, "slowplay/20000");
    step = socket.after("the playtest's call", (frame) =>
      JSON.stringify(frame).includes('"name":"playtest"')
    );
    const deleting = socket.turn("build new");
    await step();
    await sleep(300);
    const before = Date.now();
    const deleted = await deleteDraft(draft);
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

test(
  "Revisions: they keep the agent's design and tests; a box restart mid-build and a write cut short publish nothing",
  { timeout: 120_000 },
  async (t) => {
    await serve(t);
    const { id: draft } = await json("/api/drafts", {
      text: "build designed",
    });
    const socket = await connect(draft);
    await socket.until("the first build's end", over);
    assert.equal(await lastReply(draft), published(1));
    assert.deepEqual(await sourceFile(draft, "design.md"), [1, DESIGN]);
    assert.deepEqual(await sourceFile(draft, "tests.json"), [1, TESTS]);
    assert.ok(verified(await boxLog(draft), "new"));

    // The box idles out: the next run starts from the Revision, with the design and tests in it.
    await fake(draft, "stopbox");
    assert.equal(await socket.turn("build readdesign"), "turn_done");
    assert.match(await lastReply(draft), /Moon Cat design/u);

    // A change is verified as one, so a game without music can stay without it.
    assert.equal(await socket.turn("build change"), "turn_done");
    assert.equal(await lastReply(draft), published(2));
    assert.ok(verified(await boxLog(draft), "change"));

    // After a failed check, what the Creator has said is still in the box for the agent's own verify run.
    assert.equal(await socket.turn("build checkedasked"), "turn_done");
    assert.match(await lastReply(draft), /"build checkedasked"/u);

    // The box stops during build, and starts again from Revision 2: the check passes that old game, which must not
    // become Revision 3.
    await fake(draft, "stopatverify");
    assert.equal(await socket.turn("build change"), "turn_done");
    assert.match(await lastReply(draft), RESTARTED);
    assert.equal(await revisionOf(draft), 2);

    // An eviction cut Revision 3 short: it isn't current, and the next build writes 3/ whole, without its leftovers.
    await fake(draft, "partial");
    assert.equal(await revisionOf(draft), 2);
    const { length: putsBefore } = await fakeJson(draft, "puts");
    assert.equal(await socket.turn("build change"), "turn_done");
    assert.equal(await lastReply(draft), published(3));
    const [, stale] = await revisionFile(draft, "stale.js");
    assert.equal(stale, 404);

    // index.html, the mark of a whole Revision, is written only once every other file of it is.
    const allPuts = await fakeJson(draft, "puts");
    const writes = allPuts
      .slice(putsBefore)
      .filter((put) => put.includes(`drafts/${draft}/3/`));
    const indexAt = writes.indexOf(`start drafts/${draft}/3/index.html`);
    const others = writes.filter((put) => !put.endsWith("/index.html"));
    assert.ok(others.length > 0 && indexAt > 0, JSON.stringify(writes));
    for (const put of others) {
      assert.ok(writes.indexOf(put) < indexAt, JSON.stringify(writes));
    }

    // A second new game in one run still has the message that asked for it.
    assert.equal(await socket.turn("build twice"), "turn_done");
    assert.match(await lastReply(draft), /\["build twice"\]/u);

    // A Revision from before source.tgz, its source files beside its built ones: the next run restores them, and a
    // change keeps its design and music in the source.tgz Revision it publishes.
    await fake(draft, "legacy");
    const legacy = await revisionOf(draft);
    assert.equal(await socket.turn("build change"), "turn_done");
    assert.equal(await lastReply(draft), published(legacy + 1));
    assert.ok(verified(await boxLog(draft), "change --had-music"));
    assert.deepEqual(await sourceFile(draft, "design.md"), [
      legacy + 1,
      "# An older design\n",
    ]);
    assert.deepEqual(await sourceFile(draft, "music.mjs"), [
      legacy + 1,
      "// an older track",
    ]);
    assert.deepEqual(await sourceFile(draft, "game.ts"), [
      legacy + 1,
      "let speed = 2;\nfunction gameRender() {}\n",
    ]);
    assert.deepEqual(await sourceFile(draft, "music.js"), [
      legacy + 1,
      undefined,
    ]);
    assert.deepEqual(await sourceFile(draft, "game.js"), [
      legacy + 1,
      undefined,
    ]);
    const [, opus] = await revisionFile(draft, "music.opus");
    assert.equal(opus, 200);
    const [, script] = await revisionFile(draft, "music.js");
    assert.equal(script, 404);

    // A message sent while a new game builds is about that game: it counts for the change after it. The run's first
    // tool waits until a message queued before it (which the fake plays as the next script) has reached pi, so the
    // cut counts only what pi has placed in the run.
    const started = socket.after("the run's start", (frame) =>
      JSON.stringify(frame).includes('"run_start"')
    );
    const building = socket.turn("build waitwrite");
    await started();
    const early = socket.after("the early steer", steered);
    await send(draft, "build waitnew");
    await early();
    const step = socket.after("the playtest", played);
    await fake(draft, "release");
    await step();
    const late = socket.after("the late steer", steered);
    await send(draft, "No music at all.");
    await late();
    await fake(draft, "release");
    assert.equal(await building, "turn_done");
    assert.equal(await socket.turn("build asked"), "turn_done");
    assert.match(
      await lastReply(draft),
      /\["No music at all\.",\s*"build asked"\]/u
    );
    socket.close();
  }
);

test(
  "ask_advisor: the advisor gets the conversation and the question with no tools, its advice is the tool's result, and a failed advisor doesn't end the run",
  { timeout: 120_000 },
  async (t) => {
    await serve(t);
    const { left: before } = await json("/api/allowance");
    const { id: draft } = await json("/api/drafts", { text: "build advised" });
    const socket = await connect(draft);
    await socket.until("the advised turn's end", over);
    assert.match(
      await lastReply(draft),
      /said: advice: keep the levels in their own file\./u
    );
    // The agent's 3 calls and the advisor's, 1,000 hopon tokens each.
    const { left: after } = await json("/api/allowance");
    assert.equal(before - after, 4000);
    const [request, ...more] = await fakeJson(draft, "advisor");
    assert.equal(more.length, 0);
    assert.ok(!("tools" in request), "the advisor's request has no tools");
    assert.match(JSON.stringify(request.system), /You only advise/u);
    assert.equal(request.messages.length, 1);
    const [{ content }] = request.messages;
    const sent = JSON.stringify(content);
    assert.match(sent, /USER:\\nbuild advised/u, "the Creator's message");
    assert.match(sent, /\[calls write \{/u, "the agent's tool call");
    assert.match(
      sent,
      /The Maker's question:\\nShould the level data live apart from the physics\?/u
    );
    assert.doesNotMatch(
      sent,
      /history ends before this call/u,
      "no stand-in result for the ask_advisor call itself"
    );
    assert.doesNotMatch(
      JSON.stringify(request),
      /cache_control/u,
      "the advisor's one-off request writes no cache"
    );

    // A failed advisor, and one that answers nothing, each tell the agent to go on, and it does.
    for (const [script, said] of [
      ["advisorfails", /The advisor couldn't answer: .*the advisor is down/u],
      ["advisorsilent", /The advisor gave no advice: it stopped on length\./u],
    ]) {
      // oxlint-disable-next-line no-await-in-loop -- one turn after another
      assert.equal(await socket.turn(`build ${script}`), "turn_done");
      // oxlint-disable-next-line no-await-in-loop -- one turn after another
      const tools = await toolsCalled(draft);
      assert.deepEqual(tools.slice(-2), ["ask_advisor", "write"]);
      // oxlint-disable-next-line no-await-in-loop -- one turn after another
      const entries = await transcript(draft);
      assert.ok(
        entries.some(
          ({ text }) =>
            said.test(text) && text.includes("Go on without its advice")
        ),
        `${script}: the agent is told to go on`
      );
    }
    socket.close();

    // An advisor model pi-ai doesn't know fails only ask_advisor: the Maker still runs, and the agent is told to go on.
    kill();
    await start(noAdvisorVars);
    const { id: unknown } = await json("/api/drafts", {
      text: "build advised",
    });
    const fallback = await connect(unknown);
    await fallback.until("the unknown advisor's turn's end", over);
    assert.match(
      await lastReply(unknown),
      /said: The advisor is unavailable: no model claude-nope-1\. Go on without its advice/u
    );
    assert.deepEqual(await fakeJson(unknown, "advisor"), []);
    fallback.close();
  }
);

test(
  "a Vite game publishes as its source and its flat dist/, and its preview serves the module its page loads",
  { timeout: 120_000 },
  async (t) => {
    await migrate();
    await serve(t);
    const { id: draft } = await json("/api/drafts", { text: "build vite" });
    const socket = await connect(draft);
    await socket.until("the build's end", over);

    assert.equal(await lastReply(draft), published(1));
    assert.deepEqual(await sourceFile(draft, "src/main.tsx"), [
      1,
      "hopon.ready();\n",
    ]);
    const [packedAt, , packed] = await revisionFile(draft, "source.tgz");
    assert.equal(packedAt, 1);
    assert.deepEqual(Object.keys(JSON.parse(packed)).toSorted(), [
      "design.md",
      "index.html",
      "music.mjs",
      "src/main.tsx",
      "tests.json",
      "vite.config.ts",
    ]);
    const [indexAt, , index] = await revisionFile(draft, "index.html");
    assert.equal(indexAt, 1);
    assert.match(
      index,
      /<script src="\/hopon\/v1\.js" data-music="music\.opus"><\/script><script type="module" crossorigin src="\.\/index-B1x2\.js">/u
    );
    const page = await previewUrl(draft);
    const module = await fetch(page.replace(/index\.html$/u, "index-B1x2.js"));
    assert.equal(module.status, 200);
    assert.match(module.headers.get("Content-Type"), /^text\/javascript/u);
    assert.equal(module.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(await module.text(), "hopon.ready();");
    socket.close();
  }
);

// The response's bytes as the network carries them: node:http doesn't decode a Content-Encoding, as fetch does.
const raw = async (route, headers) => {
  const [response] = await once(
    http.get(`${ORIGIN}${route}`, { headers }),
    "response"
  );
  return { body: await buffer(response), headers: response.headers };
};

test("vendor under workerd: each /vendor/ file reaches a client that takes gzip gzipped once, as its frozen code", async (t) => {
  await serve(t);
  for (const { route, sha256 } of FROZEN) {
    // oxlint-disable-next-line no-await-in-loop -- one file at a time
    const { body, headers } = await raw(route, { "Accept-Encoding": "gzip" });
    assert.equal(headers["content-encoding"], "gzip", route);
    assert.equal(
      createHash("sha256").update(gunzipSync(body)).digest("hex"),
      sha256,
      `${route} unzips once to its frozen code`
    );
  }
});

// A message the Allowance refuses before any model call.
const refused = async (route, text) => {
  const response = await call(route, { text });
  assert.equal(response.status, 429);
  const { code } = await response.json();
  assert.equal(code, "allowance_used");
};

// The Allowance (ADR 0004) is 200,000 hopon tokens here (test/maker/wrangler.jsonc), and each fake model call reads
// 1,000 input tokens unless told to spend more, so its calls are 1,000 hopon tokens each.
test("allowance: each model call is charged to its Creator's week; a run's work starts only above zero, and one that starts finishes below it; then the Maker refuses until the week resets", async (t) => {
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

  // 1,000 left: the call that asks for a tool takes it to zero, so the tool is refused and the box never starts; the
  // reply after it overshoots.
  await socket.turn(`spend ${before - 2000}`);
  assert.equal(await left(), 1000);
  assert.equal(await socket.turn("build one"), "turn_done");
  assert.match(
    await lastReply(draft),
    /You've used this week's hopon tokens\. They come back when the week resets\./u
  );
  assert.deepEqual(await boxLog(draft), []);
  assert.equal(await left(), -1000);

  // At or below zero, chat and builds are refused before any model call: the transcript doesn't change.
  const entries = await transcript(draft);
  const calls = await modelCalls(draft);
  await refused(`/api/drafts/${draft}/messages`, "hello again");
  await refused(`/api/drafts/${draft}/messages`, "build new");
  await refused("/api/drafts", "build new");
  assert.deepEqual(await transcript(draft), entries);
  assert.equal(await modelCalls(draft), calls);
  socket.close();

  // A new week: this one's bucket becomes an old week's, and the Allowance is full again.
  const newWeek = async (old) => {
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
        `UPDATE generation_limits SET bucket = 'user_maker:${old}' WHERE bucket LIKE 'user_maker:%' AND bucket NOT LIKE 'user_maker:2026-W0%'`,
      ],
      { stdio: "ignore" }
    );
    const [code] = await once(moved, "exit");
    assert.equal(code, 0);
    await start();
    assert.equal(await left(), 200_000);
  };
  await newWeek("2026-W01");

  // 1,500 left: the run's first call leaves 500, so its work starts, and it finishes though its later calls overshoot:
  // 3 tool calls and the reply.
  const again = await connect(draft);
  // Two calls: one of 198,500 input tokens would overflow the model's context.
  await again.turn("spend 99250");
  await again.turn("spend 99250");
  assert.equal(await left(), 1500);
  assert.equal(await again.turn("build new"), "turn_done");
  assert.equal(await revisionOf(draft), 1);
  assert.equal(await left(), 1500 - 4000);

  // 1,500 left again: the run's first call leaves 500, so its work starts; its third leaves -1,500, so the done check
  // asks no advisor and tells the agent to go on, and the run still builds the Revision the Creator paid for.
  again.close();
  await newWeek("2026-W02");
  const advised = await connect(draft);
  await advised.turn("spend 99250");
  await advised.turn("spend 99250");
  assert.equal(await advised.turn("build advisedbuild"), "turn_done");
  assert.deepEqual(await fakeJson(draft, "advisor"), []);
  const advisedEntries = await transcript(draft);
  const [told, ...more] = advisedEntries.filter(({ text }) =>
    text.includes("The advisor wasn't asked")
  );
  assert.equal(more.length, 0);
  assert.match(told.text, /Go on without its advice/u);
  assert.doesNotMatch(told.text, /Allowance is used up/u);
  assert.equal(await lastReply(draft), published(2));
  advised.close();
});
