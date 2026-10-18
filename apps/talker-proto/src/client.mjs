/* oxlint-disable complexity, curly, func-style, no-multi-assign, no-sequences, no-unreadable-array-destructuring, no-unused-expressions, no-use-before-define, prefer-add-event-listener, prefer-array-find, require-unicode-regexp -- PROTOTYPE (#128): throwaway code on prototype/talker-framework */
// PROTOTYPE (#128): the reconnect logic of prototype/rn-websocket's ws-test.tsx, in Node, for both Talkers.
// node src/client.mjs b <draft>   B: apply events by seq (drop duplicates, flag gaps), reconnect with since=last.
// node src/client.mjs a <draft>   A: pi has no cursor: every connect starts with a snapshot that replaces the view.
// Reconnects with jittered backoff capped at 5 s; 40 s without a message during a running turn counts as lost.
// `kill -USR1 <pid>` drops the socket for 20 s ("away"), to check what a client that was away misses.
const [, , mode, draft = "proto"] = process.argv;
const port = { a: 8791, a2: 8793, a2r0: 8794, b: 8792 }[mode];
const base = `ws://localhost:${port}/d/${draft}/ws`;
const isA = mode !== "b";
const s = { attempt: 0, away: false, dup: 0, gap: 0, last: 0, running: false, seen: new Set(), silence: undefined, ws: undefined };
const log = (line) => console.log(`${new Date().toISOString().slice(11, 23)} ${line}`);

const drop = (why) => {
  clearTimeout(s.silence);
  if (s.ws) {
    s.ws.onclose = s.ws.onmessage = s.ws.onerror = null;
    s.ws.close(1000, why);
    s.ws = undefined;
    log(`closed (${why})`);
  }
};
const later = () => {
  const ms = Math.min(5000, 250 * 2 ** s.attempt) * (0.5 + Math.random() / 2);
  s.attempt += 1;
  setTimeout(connect, ms);
};
const arm = () => {
  clearTimeout(s.silence);
  if (s.running) {
    s.silence = setTimeout(() => (log("40 s silent during a turn: lost"), drop("silence"), later()), 40_000);
  }
};

function onB(m) {
  if (m.type === "state") return ((s.running = m.data.status === "running"), log(`state ${m.data.status}`));
  if (m.type === "tick") return log("tick");
  if (m.seq <= s.last) return ((s.dup += 1), log(`DUPLICATE #${m.seq}`));
  if (m.seq !== s.last + 1) ((s.gap += 1), log(`GAP: expected #${s.last + 1}, got #${m.seq}`));
  s.last = m.seq;
  if (m.type === "turn_started") s.running = true;
  if (m.type === "turn_done" || m.type === "turn_failed") s.running = false;
  log(`#${m.seq} ${m.type} ${JSON.stringify(m.data).slice(0, 140)}`);
}

// A: the snapshot is the whole state; batches after it are pi's agent events. The view is rebuilt from the snapshot.
function onA(m) {
  if (m.type === "snapshot") {
    const e = m.data;
    s.running = Boolean(e.run);
    const fresh = e.entries.filter((entry) => !s.seen.has(entry.id));
    for (const entry of e.entries) s.seen.add(entry.id);
    const tools = e.tools.map((t) => `${t.toolName ?? t.name}:${t.status ?? "?"}:${String(t.output ?? "").split("\n").filter(Boolean).at(-1) ?? ""}`);
    log(`SNAPSHOT entries=${e.entries.length} (new since last view: ${fresh.length}) run=${Boolean(e.run)} tools=[${tools}] inbox=${e.inbox.length} partial=${Boolean(e.generation?.message)}`);
    return;
  }
  if (m.type !== "batch") return log(`other frame ${m.type}`);
  for (const ev of m.data) {
    if (ev.type === "run_start") s.running = true;
    if (ev.type === "run_end") s.running = false;
    if (ev.type === "entry_appended" || ev.type === "message_end") s.seen.add((ev.entry ?? {}).id);
    if (ev.type === "message_update" || (ev.type === "tool_execution_update" && !/0\/60|done|cancel/.test(ev.output?.append ?? ""))) continue;
    log(`pi ${ev.type} ${JSON.stringify(ev.entry?.model?.[0]?.content ?? ev.output ?? ev.args ?? ev.items ?? "").slice(0, 140)}`);
  }
}

function connect() {
  if (s.ws || s.away) return;
  const started = Date.now();
  const ws = new WebSocket(isA ? base : `${base}?since=${s.last}`);
  s.ws = ws;
  log(`connect ${isA ? "(snapshot)" : `since=${s.last}`}`);
  let first = true;
  ws.onmessage = (event) => {
    if (first) ((first = false), (s.attempt = 0), log(`first message ${Date.now() - started} ms`));
    const m = JSON.parse(String(event.data));
    (isA ? onA : onB)(m);
    arm();
  };
  ws.onclose = (event) => ((s.ws = undefined), log(`socket closed ${event.code}`), later());
  ws.onerror = () => log("socket error");
}

process.on("SIGUSR1", () => {
  log("AWAY for 20 s");
  s.away = true;
  drop("away");
  setTimeout(() => ((s.away = false), log("BACK"), connect()), 20_000);
});
process.on("SIGINT", () => (log(`last #${s.last} dup ${s.dup} gap ${s.gap}`), process.exit(0)));
connect();
