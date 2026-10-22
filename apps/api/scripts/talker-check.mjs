// The Talker under wrangler (#141): the prototype's evict and snapshot scripts (prototype/talker-framework,
// apps/talker-proto/scripts/evict.sh and snap.sh), kept as the upgrade test for PiHarness and pi-durable. Re-run it
// whenever agents, pi-durable or pi-ai change. It makes real model calls through modelFetch, so it needs
// CLOUDFLARE_API_KEY in the environment:
//
//   CLOUDFLARE_API_KEY=… node scripts/talker-check.mjs
//
// It starts its own `wrangler dev` on fresh local state, signs its own Clerk tokens, and checks, against a client that
// keeps its view the way the app will (each snapshot redraws it, batches patch it):
//   1. a client connects, gets a snapshot, sends a message, sees the reply stream and turn_done
//   2. a client away mid-turn comes back mid-turn, and a steer joins the turn: the view matches the server's
//   3. evict: the server is killed mid-turn and restarted; with no requests the turn finishes by itself
//   4. restart mid-turn with a client that reconnects on its own: the view matches the server's
//   5. 40 s idle with the socket held: the object hibernated, and the next message wakes it
//   6. Stop mid-turn: turn_failed, and the view matches the server's
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 8799;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const API = new URL("..", import.meta.url).pathname;
const state = mkdtempSync(path.join(tmpdir(), "talker-check-"));
const log = (line) =>
  console.log(`${new Date().toISOString().slice(11, 23)} ${line}`);

if (!process.env.CLOUDFLARE_API_KEY) {
  throw new Error("Set CLOUDFLARE_API_KEY, modelFetch's Cloudflare API token");
}

// A throwaway Clerk key: the server verifies tokens signed with it, as test/worker.test.js does.
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
const token = async () => {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ exp: now + 600, iat: now, nbf: now, sub: "user_check" })}`;
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
  `CLERK_JWT_KEY="${pem}"\nCLOUDFLARE_API_KEY="${process.env.CLOUDFLARE_API_KEY}"\n`
);

const run = async (args) => {
  const [code] = await once(
    spawn("npx", ["wrangler", ...args], { cwd: API, stdio: "ignore" }),
    "exit"
  );
  assert.equal(code, 0, `wrangler ${args[0]} exited ${code}`);
};

// HOPON_OFFLINE skips Screening, which isn't under test, so nothing needs the remote AI binding.
let server;
const start = async () => {
  server = spawn(
    "npx",
    [
      "wrangler",
      "dev",
      "--local",
      "--port",
      `${PORT}`,
      "--persist-to",
      state,
      "--env-file",
      vars,
      "--var",
      "HOPON_OFFLINE:1",
    ],
    { cwd: API, detached: true, stdio: ["ignore", "pipe", "pipe"] }
  );
  server.stdout.on("data", (data) =>
    process.stdout.write(
      `${`  | ${data}`.replaceAll("\n", "\n  | ").trimEnd()}\n`
    )
  );
  server.stderr.on("data", (data) => process.stderr.write(`  | ${data}`));
  for (;;) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- polling until the server answers
      await fetch(ORIGIN);
      return;
    } catch {
      // oxlint-disable-next-line no-await-in-loop -- polling until the server answers
      await sleep(250);
    }
  }
};
// SIGKILL, so nothing shuts down cleanly: the closest local stand-in for an eviction.
const kill = () => {
  process.kill(-server?.pid, "SIGKILL");
  log("server killed");
};

const api = async (route, body) => {
  const response = await fetch(`${ORIGIN}${route}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/json",
    },
    method: body === undefined ? "GET" : "POST",
  });
  assert.ok(
    response.ok,
    `${route}: ${response.status} ${await response.clone().text()}`
  );
  return response.status === 204 ? null : response.json();
};

const until = async (what, check, ms = 60_000) => {
  const deadline = Date.now() + ms;
  while (!check()) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${what}`);
    // oxlint-disable-next-line no-await-in-loop -- polling
    await sleep(50);
  }
};

// The app's side of #128: the view is redrawn from every snapshot and patched by batches. `reconnect` retries with
// backoff capped at 5 s, as the app will; without it a dropped socket stays down.
class Client {
  constructor(draft, { reconnect = true } = {}) {
    Object.assign(this, { draft, frames: [], reconnect });
    this.view = {
      entries: new Map(),
      inbox: [],
      outcomes: [],
      running: false,
      text: "",
    };
  }

  async connect() {
    const { ticket } = await api(`/api/drafts/${this.draft}/ws-ticket`, {});
    const socket = new WebSocket(
      `ws${ORIGIN.slice(4)}/api/drafts/${this.draft}/ws?ticket=${ticket}`
    );
    this.socket = socket;
    this.ping = setInterval(
      () => socket.readyState === 1 && socket.send("ping"),
      20_000
    );
    socket.addEventListener(
      "message",
      ({ data }) => data !== "pong" && this.apply(JSON.parse(data))
    );
    socket.addEventListener("close", () => {
      clearInterval(this.ping);
      if (this.socket === socket && this.reconnect) {
        this.retry(0);
      }
    });
    await until(
      "the snapshot",
      () =>
        this.frames.at(-1)?.type === "snapshot" &&
        this.frames.at(-1).socket === socket
    );
  }

  async retry(attempt) {
    await sleep(Math.min(5000, 250 * 2 ** attempt));
    try {
      await this.connect();
      log(`reconnected after ${attempt + 1} attempts`);
    } catch {
      this.retry(attempt + 1);
    }
  }

  close() {
    const { socket } = this;
    this.socket = undefined;
    clearInterval(this.ping);
    socket?.close();
  }

  apply(frame) {
    this.frames.push({ ...frame, at: Date.now(), socket: this.socket });
    const { view } = this;
    if (frame.type === "snapshot") {
      view.entries = new Map(
        frame.data.entries.map((entry) => [entry.id, entry])
      );
      view.inbox = frame.data.inbox.map((item) => item.id);
      view.running = Boolean(frame.data.run);
    } else if (frame.type === "turn_done" || frame.type === "turn_failed") {
      view.outcomes.push(frame.type);
    } else if (frame.type === "batch") {
      for (const event of frame.data) {
        if (event.entry) {
          view.entries.set(event.entry.id, event.entry);
        }
        if (event.type === "run_start") {
          view.running = true;
        } else if (event.type === "run_end") {
          view.running = false;
        } else if (event.type === "inbox_update") {
          view.inbox = event.items.map((item) => item.id);
        } else if (event.type === "message_update") {
          for (const change of event.changes) {
            view.text += change.type === "text_delta" ? change.delta : "";
          }
        }
      }
    }
  }

  saw(type, since = 0) {
    return this.frames.some(
      (frame) =>
        frame.at >= since &&
        (frame.type === type ||
          (frame.type === "batch" &&
            frame.data.some((event) => event.type === type)))
    );
  }
}

const transcript = (entries) =>
  [...entries].map((entry) => `${entry.id}:${entry.kind}`);
// The server's transcript, as a fresh connection's snapshot shows it.
const matchesServer = async (client, step) => {
  const fresh = new Client(client.draft, { reconnect: false });
  await fresh.connect();
  fresh.close();
  assert.deepEqual(
    transcript(client.view.entries.values()),
    transcript(fresh.view.entries.values()),
    step
  );
  assert.equal(client.view.running, false, step);
  log(`${step}: view matches the server, ${client.view.entries.size} entries`);
};
const send = (client, text) =>
  api(`/api/drafts/${client.draft}/messages`, { text });
const turns = async (client, n) => {
  await until(
    `${n} outcomes`,
    () => client.view.outcomes.length >= n && !client.view.running,
    120_000
  );
};

try {
  await run([
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--persist-to",
    state,
  ]);
  await start();

  // 1. Connect, send, the reply streams, turn_done.
  const { id } = await api("/api/drafts", {
    text: "Hi! I'd like a game with a cat in it.",
  });
  const client = new Client(id);
  await client.connect();
  await turns(client, 1);
  const before = client.view.text.length;
  const sent = Date.now();
  await send(client, "What would you call it?");
  await turns(client, 2);
  assert.ok(
    client.saw("message_update", sent) && client.view.text.length > before,
    "the reply streamed"
  );
  assert.deepEqual(client.view.outcomes, ["turn_done", "turn_done"]);
  log("1 stream: snapshot, reply streamed, turn_done");

  // 2. Away mid-turn, back mid-turn, a steer.
  let mark = Date.now();
  await send(client, "Tell me in one sentence how the cat moves.");
  await until("run_start", () => client.saw("run_start", mark));
  client.close();
  await sleep(300);
  client.reconnect = true;
  await client.connect();
  assert.ok(client.view.running, "the reconnect snapshot is mid-turn");
  await send(client, "Actually, make the cat orange.");
  await turns(client, 4);
  await matchesServer(client, "2 away mid-turn + steer");

  // 3. Evict: killed mid-turn, restarted, no requests: the turn finishes by itself.
  client.reconnect = false;
  mark = Date.now();
  await send(client, "And what does the cat chase?");
  await until("run_start", () => client.saw("run_start", mark));
  kill();
  client.close();
  await start();
  log("server back; no requests for 30 s");
  await sleep(30_000);
  const after = new Client(id, { reconnect: false });
  await after.connect();
  after.close();
  const last = [...after.view.entries.values()].at(-1);
  assert.equal(after.view.running, false, "the turn finished with no requests");
  assert.equal(
    last.kind,
    "pi.assistant",
    "the turn ended with the Maker's reply"
  );
  log("3 evict: the turn finished by itself");

  // 4. Restart mid-turn with a client that reconnects on its own.
  client.reconnect = true;
  await client.connect();
  const done = client.view.outcomes.length;
  mark = Date.now();
  await send(client, "Give the game a two-word name.");
  await until("run_start", () => client.saw("run_start", mark));
  kill();
  await start();
  await until(
    "the turn's end",
    () => !client.view.running && client.saw("snapshot", mark),
    120_000
  );
  await matchesServer(
    client,
    `4 restart (${client.view.outcomes.length - done} outcomes seen live)`
  );

  // 5. Hibernation: 40 s idle with the socket held. A woken object re-attaches held sockets with a fresh snapshot.
  log("idle 40 s with the socket held");
  await sleep(40_000);
  mark = Date.now();
  await send(client, "Say bye in three words.");
  await until("run_end", () => client.saw("run_end", mark));
  assert.ok(
    client.saw("snapshot", mark),
    "the object hibernated: the held socket got a fresh snapshot on wake"
  );
  await matchesServer(client, "5 hibernated, woke on the next message");

  // 6. Stop mid-turn.
  mark = Date.now();
  await send(client, "Describe the cat's fur in detail, in two sentences.");
  await until("run_start", () => client.saw("run_start", mark));
  await api(`/api/drafts/${id}/stop`, {});
  await until("turn_failed", () => client.saw("turn_failed", mark));
  await until("run_end", () => !client.view.running);
  await matchesServer(client, "6 stop");
  const { drafts } = await api("/api/drafts");
  assert.ok(
    drafts[0].updatedAt > drafts[0].createdAt || drafts[0].id === id,
    "the row is dated by turns"
  );
  log("all checks passed");
  client.reconnect = false;
  client.close();
} finally {
  kill();
}
