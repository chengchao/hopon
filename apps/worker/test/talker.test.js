// The Talker's `build` (#143) under `wrangler dev`, through the Worker's routes and a WebSocket, as the app sees it.
// test/talker/worker.ts fakes the Coder (scripted NDJSON) and the model (a message "build <scenario>" calls build),
// so this needs no key and makes no model call. The Coder's requests are read back through the fake.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

const API = new URL("..", import.meta.url).pathname;
const CONFIG = new URL("talker/wrangler.jsonc", import.meta.url).pathname;
const state = mkdtempSync(path.join(tmpdir(), "talker-test-"));

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

// One socket to the Draft's Talker and every frame it gets.
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
    const deadline = Date.now() + 20_000;
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

// The Talker's transcript, from a fresh snapshot: each entry's kind and text.
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
const coderCalls = (draft) => json(`/__fake/coder/${draft}/calls`);
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

test("build: a message makes and changes the game as Revisions in R2; failures, Stop, the timer, a restart and the quota", async (t) => {
  const migrate = wrangler(
    ["d1", "migrations", "apply", "DB", "--local", "--persist-to", state],
    { stdio: "ignore" }
  );
  const [code] = await once(migrate, "exit");
  assert.equal(code, 0);
  await start();
  t.after(kill);
  t.after(() => {
    if (!t.passed) {
      process.stdout.write(Buffer.concat(serverLog));
    }
  });

  // A new Draft's first build writes 1/; the D1 row gets the title.
  const { id: draft } = await json("/api/drafts", { text: "build done" });
  let socket = await connect(draft);
  // The fakes are quick, so the first turn may be over before the socket's snapshot.
  await socket.until("the first turn's end", over);
  assert.deepEqual(await revisionFile(draft, "index.html"), [
    1,
    200,
    "<!doctype html>moon cat",
  ]);
  assert.deepEqual(await revisionFile(draft, "music.js"), [
    1,
    200,
    'hopon.music = "T2dnUw==";',
  ]);
  // Gzipped by the runtime (workerd), from the Worker's Content-Encoding; fetch decodes it, so the text above held.
  const page = await previewUrl(draft);
  const gzipped = await fetch(page.replace(/index\.html$/u, "music.js"), {
    headers: { "Accept-Encoding": "gzip" },
  });
  assert.equal(gzipped.headers.get("Content-Encoding"), "gzip");
  assert.equal(await gzipped.text(), 'hopon.music = "T2dnUw==";');
  const { drafts } = await json("/api/drafts");
  assert.equal(drafts[0].title, "Moon Cat");
  assert.equal(await lastReply(draft), "said: A cat on the moon. Tap to jump.");

  // The next build gets the source (never game.js or music.js) and writes 2/ with the carried-over files; 1/ is gone.
  const first = await previewUrl(draft);
  assert.equal(await socket.turn("build done"), "turn_done");
  assert.deepEqual(await revisionFile(draft, "game.ts"), [
    2,
    200,
    "// revision 2",
  ]);
  assert.deepEqual(await revisionFile(draft, "index.html"), [
    2,
    200,
    "<!doctype html>moon cat",
  ]);
  assert.deepEqual(await revisionFile(draft, "music.js"), [
    2,
    200,
    'hopon.music = "T2dnUw==";',
  ]);
  const [, dropped] = await revisionFile(draft, "music.mjs");
  assert.equal(dropped, 404);
  const gone = await fetch(first);
  assert.equal(gone.status, 404);
  let calls = await coderCalls(draft);
  assert.deepEqual(calls.at(-1).source, ["game.ts", "index.html", "music.mjs"]);

  // A failed build leaves 2/ alone; busy has its own line.
  assert.equal(await socket.turn("build failed"), "turn_done");
  assert.match(
    await lastReply(draft),
    /The build failed: playtest stayed red/u
  );
  await socket.turn("build busy");
  assert.match(
    await lastReply(draft),
    /The Maker is busy\. Try again in a minute\./u
  );
  assert.deepEqual(await revisionFile(draft, "game.ts"), [
    2,
    200,
    "// revision 2",
  ]);

  // A Coder that never answers: the abort timer ends the turn turn_failed and cancels the job.
  assert.equal(await socket.turn("build hang"), "turn_failed");
  calls = await coderCalls(draft);
  const [hung, cancelled] = calls.slice(-2);
  assert.deepEqual(cancelled, { cancel: true, jobId: hung.jobId });

  // Stop mid-build, once the Coder's step label reached the socket: turn_failed, then the job is cancelled; the game
  // hasn't changed.
  let step = socket.after("the step label", stepLabel);
  const stopped = socket.turn("build wait");
  await step();
  // Publish waits for the turn to end (#145).
  const publishing = await call(`/api/drafts/${draft}/publish`, {});
  assert.equal(publishing.status, 409);
  await call(`/api/drafts/${draft}/stop`, {});
  assert.equal(await stopped, "turn_failed");
  calls = await coderCalls(draft);
  assert.deepEqual(calls.at(-1), { cancel: true, jobId: calls.at(-2).jobId });
  const [unchanged] = await revisionFile(draft, "game.ts");
  assert.equal(unchanged, 2);

  // A steer sent mid-build reaches the Talker after build returns.
  step = socket.after("the step label", stepLabel);
  const building = socket.turn("build wait");
  await step();
  const queued = socket.after("the queued steer", steered);
  await send(draft, "make it orange");
  await queued();
  await call(`/__fake/coder/${draft}/release`, {});
  assert.equal(await building, "turn_done");
  const entries = await transcript(draft);
  const result = entries.findLastIndex((entry) => entry.text === "Revision 3.");
  const steer = entries.findLastIndex(
    (entry) => entry.text === "make it orange"
  );
  assert.ok(result !== -1 && result < steer, JSON.stringify(entries.slice(-4)));
  assert.match(entries.at(-1).text, /make it orange/u);

  // A restart mid-build re-attaches to the same job: one start, one attach, and the Revision is written.
  step = socket.after("the step label", stepLabel);
  await send(draft, "build wait");
  await step();
  socket.close();
  kill();
  await start();
  socket = await connect(draft);
  await socket.until("the turn's end after the restart", over);
  calls = await coderCalls(draft);
  const [started, attached] = calls.slice(-2);
  assert.equal(started.jobId, attached.jobId);
  assert.ok(!started.cancel && !attached.cancel);
  const [restarted] = await revisionFile(draft, "game.ts");
  assert.equal(restarted, 4);

  // 7 builds so far (failed, stopped and timed-out ones count, the busy one doesn't): the 8th, 9th and 10th run, the
  // 11th is refused without the Coder.
  await socket.turn("build done");
  await socket.turn("build done");
  await socket.turn("build done");
  calls = await coderCalls(draft);
  await socket.turn("build done");
  assert.deepEqual(await coderCalls(draft), calls);
  assert.match(
    await lastReply(draft),
    /You've made 10 games today; come back tomorrow\./u
  );

  // Between turns, Publish turns the last Revision into a Game with the Maker's title and description, and the Draft
  // goes.
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
  assert.equal(await game.text(), "// revision 7");
  assert.deepEqual(await json("/api/drafts"), { drafts: [] });
  socket.close();
});
