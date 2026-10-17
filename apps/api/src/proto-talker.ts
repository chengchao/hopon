/* oxlint-disable no-promise-executor-return, promise/prefer-await-to-then, promise/prefer-await-to-callbacks -- PROTOTYPE */
// PROTOTYPE for #126 (docs/research/rn-websocket-prototype.md): a Talker stand-in. One SQLite-backed Durable Object
// per Draft keeps a numbered event log and pushes it to WebSockets accepted with the Hibernation API.
import { DurableObject } from "cloudflare:workers";

interface Event {
  seq: number;
  turn: number;
  type: string;
  data: unknown;
}

const log = (id: string, line: string) =>
  console.log(
    `[talker ${new Date().toISOString().slice(11, 23)} ${id}] ${line}`
  );

const sleep = (ms: number) =>
  // oxlint-disable-next-line promise/avoid-new -- a plain timer.
  new Promise((resolve) => setTimeout(resolve, ms));

export class TalkerProto extends DurableObject<Env> {
  // In memory only: a running turn pins the object (timers and a pending fetch), so it can't hibernate mid-turn.
  running = false;
  instance = crypto.randomUUID().slice(0, 4);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY, turn INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL)`);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS tickets (ticket TEXT PRIMARY KEY, expires INTEGER NOT NULL)"
    );
    log(
      this.instance,
      `constructor (wake): ${this.latest()} events, ${ctx.getWebSockets().length} sockets held`
    );
  }

  latest() {
    return (
      this.ctx.storage.sql
        .exec<{ seq: number | null }>("SELECT max(seq) AS seq FROM events")
        .one().seq ?? 0
    );
  }

  turn() {
    return (
      this.ctx.storage.sql
        .exec<{ turn: number | null }>("SELECT max(turn) AS turn FROM events")
        .one().turn ?? 0
    );
  }

  broadcast(message: Event) {
    const text = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        // A socket closing under us; its close handler cleans up.
      }
    }
  }

  append(turn: number, type: string, data: unknown = {}) {
    const seq = this.latest() + 1;
    this.ctx.storage.sql.exec(
      "INSERT INTO events (seq, turn, type, data) VALUES (?, ?, ?, ?)",
      seq,
      turn,
      type,
      JSON.stringify(data)
    );
    log(this.instance, `append #${seq} ${type}`);
    this.broadcast({ data, seq, turn, type });
  }

  ticket() {
    const ticket = crypto.randomUUID();
    this.ctx.storage.sql.exec(
      "DELETE FROM tickets WHERE expires < ?",
      Date.now()
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO tickets (ticket, expires) VALUES (?, ?)",
      ticket,
      Date.now() + 60_000
    );
    return ticket;
  }

  // 10 steps in 10 s, a 40 s quiet stretch where only ticks arrive (the Coder's build), 10 more steps, `turn_done`.
  // Ticks are not logged: they carry the latest seq and only prove the socket is alive.
  startTurn(origin: string) {
    if (this.running) {
      return { started: false };
    }
    this.running = true;
    const turn = this.turn() + 1;
    log(this.instance, `turn ${turn} start`);
    const tick = setInterval(() => {
      log(this.instance, `tick (latest #${this.latest()})`);
      this.broadcast({ data: {}, seq: this.latest(), turn, type: "tick" });
    }, 15_000);
    const run = async () => {
      this.append(turn, "turn_started");
      // Stands in for the Coder: pending I/O for the whole turn.
      const coder = fetch(`${origin}/api/proto/slow?ms=60000`).then((r) =>
        r.text()
      );
      for (let step = 1; step <= 20; step += 1) {
        // oxlint-disable-next-line no-await-in-loop -- steps go out one at a time.
        await sleep(step === 11 ? 40_000 : 1000);
        this.append(turn, "step", { step });
      }
      log(this.instance, `coder answered: ${await coder}`);
      this.append(turn, "turn_done");
    };
    run()
      .catch((error) => this.append(turn, "turn_failed", String(error)))
      .finally(() => {
        clearInterval(tick);
        this.running = false;
        log(this.instance, `turn ${turn} end`);
      });
    return { started: true, turn };
  }

  // The Worker forwards the upgrade here. `preauthorized` is set by the Worker only (header auth, test (e)).
  fetch(request: Request) {
    const url = new URL(request.url);
    const ticket = url.searchParams.get("ticket") ?? "";
    const used = this.ctx.storage.sql
      .exec(
        "DELETE FROM tickets WHERE ticket = ? AND expires >= ? RETURNING ticket",
        ticket,
        Date.now()
      )
      .toArray().length;
    if (!used && request.headers.get("X-Proto-Preauthorized") !== "1") {
      log(this.instance, "upgrade refused: bad or used ticket");
      return new Response("Bad ticket", { status: 401 });
    }
    const since = Number(url.searchParams.get("since") ?? 0);
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const latest = this.latest();
    server.send(
      JSON.stringify({
        data: {
          latest,
          status: this.running ? "running" : "idle",
          turn: this.turn(),
        },
        seq: latest,
        turn: this.turn(),
        type: "state",
      })
    );
    const replay = this.ctx.storage.sql
      .exec<{ seq: number; turn: number; type: string; data: string }>(
        "SELECT seq, turn, type, data FROM events WHERE seq > ? ORDER BY seq",
        since
      )
      .toArray();
    for (const event of replay) {
      server.send(JSON.stringify({ ...event, data: JSON.parse(event.data) }));
    }
    log(
      this.instance,
      `socket accepted since=${since}, replayed ${replay.length}, ${this.ctx.getWebSockets().length} held`
    );
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer) {
    log(this.instance, `message ${String(message)}`);
  }

  webSocketClose(ws: WebSocket, code: number, reason: string) {
    log(this.instance, `socket closed ${code} ${reason}`);
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }

  webSocketError(_ws: WebSocket, error: unknown) {
    log(this.instance, `socket error ${String(error)}`);
  }
}
