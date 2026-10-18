/* oxlint-disable complexity, curly, default-case, func-style, no-multi-assign, no-sequences, no-unreadable-array-destructuring, no-unused-expressions, no-use-before-define, prefer-add-event-listener, switch-case-braces -- PROTOTYPE (#128): throwaway code on prototype/talker-framework */
// PROTOTYPE (#128): snapshot-on-connect, as the app would do it against the pi Talker (src/a2.ts).
// node src/view-client.mjs <port> <draft> <dump.json>
// The view is rebuilt from the snapshot on every connect, then patched by pi's batches. It is what a chat screen
// needs: the transcript entries, whether a turn runs, the running tool and its output, queued steers, the outcome of
// each turn (turn_done / turn_failed, from pi's submission records). Reconnects with backoff capped at 5 s; 40 s
// without a frame during a turn counts as lost. `kill -USR1` = away 20 s; `kill -USR2` = write the view to <dump.json>.
import { writeFileSync } from "node:fs";

const [, , port, draft, dumpPath] = process.argv;
const url = `ws://localhost:${port}/d/${draft}/ws`;
const view = { entries: new Map(), inbox: [], outcomes: [], partial: "", running: false, tools: new Map() };
const s = { attempt: 0, away: false, silence: undefined, ws: undefined };
const log = (line) => console.log(`${Date.now()} ${new Date().toISOString().slice(11, 23)} ${line}`);
const text = (entry) =>
  (entry.model ?? [])
    .flatMap((m) => (typeof m.content === "string" ? [m.content] : (m.content ?? []).map((p) => p.text ?? (p.name ? `[${p.name}]` : ""))))
    .join(" ")
    .slice(0, 60);

function applySnapshot(snap) {
  view.entries = new Map(snap.entries.map((e) => [e.id, e]));
  view.tools = new Map(snap.tools.map((t) => [t.callId, { name: t.name, output: t.output ?? "", status: t.status }]));
  view.inbox = snap.inbox.map((i) => i.id);
  view.running = Boolean(snap.run);
  view.partial = (snap.generation?.message?.content ?? []).map((p) => p.text ?? "").join("");
}

function applyEvent(ev) {
  if (ev.entry && typeof ev.entry === "object") view.entries.set(ev.entry.id, ev.entry);
  switch (ev.type) {
    case "run_start":
      view.running = true;
      view.tools.clear();
      break;
    case "run_end":
      view.running = false;
      view.partial = "";
      break;
    case "message_start":
      view.partial = "";
      break;
    case "message_update":
      for (const c of ev.changes) if (c.type === "text_delta") view.partial += c.delta;
      break;
    case "tool_execution_start":
      view.tools.set(ev.toolCallId, { name: ev.toolName, output: "", status: "running" });
      break;
    case "tool_execution_update": {
      const slot = view.tools.get(ev.toolCallId);
      if (slot && ev.output) slot.output = "set" in ev.output ? ev.output.set : slot.output.slice(ev.output.trimStart ?? 0) + (ev.output.append ?? "");
      break;
    }
    case "tool_execution_end": {
      const slot = view.tools.get(ev.toolCallId);
      if (slot) slot.status = "done";
      break;
    }
    case "inbox_update":
      view.inbox = ev.items.map((i) => i.id);
      break;
    case "submission":
      if (ev.record.status === "done") (view.outcomes.push("turn_done"), log("TURN_DONE"));
      if (ev.record.status === "unanswered") (view.outcomes.push(`turn_failed: ${ev.record.reason}`), log(`TURN_FAILED ${ev.record.reason}`));
      if (ev.record.status === "queued") log("queued (steer or follow-up)");
      break;
  }
}

const summary = () => {
  const tool = [...view.tools.values()].map((t) => `${t.name}:${t.status}:${t.output.trim().split("\n").at(-1) ?? ""}`).join(",");
  return `entries=${view.entries.size} running=${view.running} tools=[${tool}] inbox=${view.inbox.length} last="${text([...view.entries.values()].at(-1) ?? {})}"`;
};

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
  if (view.running) s.silence = setTimeout(() => (log("40 s silent during a turn: lost"), drop("silence"), later()), 40_000);
};

function connect() {
  if (s.ws || s.away) return;
  const started = Date.now();
  const ws = new WebSocket(url);
  s.ws = ws;
  ws.onmessage = (event) => {
    const raw = String(event.data);
    const m = JSON.parse(raw);
    s.attempt = 0;
    if (m.type === "snapshot") {
      applySnapshot(m.data);
      log(`SNAPSHOT ${raw.length} bytes, ${Date.now() - started} ms after connect: ${summary()}`);
    } else if (m.type === "tick") {
      log("tick");
    } else if (m.type === "batch") {
      const before = summary();
      for (const ev of m.data) applyEvent(ev);
      const types = m.data.map((ev) => ev.type).filter((t) => t !== "message_update" && t !== "usage_changed");
      if (types.includes("run_start")) log("RUN_START");
      if (summary() !== before && types.length) log(`${types.join(",")} -> ${summary()}`);
    }
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
process.on("SIGUSR2", () => {
  writeFileSync(dumpPath, JSON.stringify({ entries: [...view.entries.values()].map((e) => ({ id: e.id, kind: e.kind, text: text(e) })), outcomes: view.outcomes, running: view.running }));
  log(`view written to ${dumpPath}`);
});
process.on("SIGINT", () => process.exit(0));
connect();
