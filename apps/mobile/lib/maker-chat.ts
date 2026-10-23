// The Make tab's chat (#147): a pure function of the Talker's latest snapshot plus the live batches since it
// (apps/worker/src/talker.ts sends pi-durable's events), and of the messages this app has sent but the Talker hasn't
// taken yet. The socket and the screen live in app/create.tsx; this is the part the tests drive.

// The slice of pi-durable's types the chat reads.
interface Block {
  type: string;
  text?: string;
  thinking?: string;
  // A toolCall's.
  id?: string;
  name?: string;
  arguments?: { title?: string };
}
interface Message {
  role: string;
  content: string | Block[];
  // A toolResult's.
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}
interface Entry {
  id: number;
  kind: string;
  model?: Message[];
}
// A running tool call; the build's output is the Coder's step labels, one a line.
interface ToolSlot {
  callId: string;
  name: string;
  status: string;
  output?: string;
}
interface Snapshot {
  type: "snapshot";
  entries: Entry[];
  inbox: { mode: string }[];
  run?: unknown;
  generation?: { message?: Message };
  tools?: ToolSlot[];
}
type ToolOutput = { trimStart?: number; append?: string } | { set: string };
type ToolEvent =
  | { type: "tool_execution_start"; toolCallId: string; toolName: string }
  | { type: "tool_execution_update"; toolCallId: string; output?: ToolOutput }
  | { type: "tool_execution_end"; toolCallId: string; entry?: Entry };
type Change =
  | {
      type: "text_start" | "thinking_start" | "toolcall_start" | "block";
      contentIndex: number;
      block: Block;
    }
  | {
      type: "text_delta" | "thinking_delta";
      contentIndex: number;
      delta: string;
    }
  | { type: "toolcall_delta" }
  | { type: "message"; message: Message };
type AgentEvent =
  | Snapshot
  | { type: "run_start" | "run_end" }
  | { type: "message_start"; message: Message }
  | { type: "message_update"; changes: Change[] }
  // requestId is the operation id the messages POST answers with.
  | { type: "submission"; record: { requestId?: string; status: string } }
  | { type: "inbox_update"; items: { mode: string }[] }
  | ToolEvent
  | { type: string; entry?: Entry };

export type Frame =
  | { type: "snapshot"; data: Snapshot }
  | { type: "batch"; data: AgentEvent[] }
  | { type: "tick" }
  | { type: "turn_done"; id: number }
  | { type: "turn_failed"; id: number; reason: string };

// A message this app sent: `op` is set once the POST answers.
interface Pending {
  key: string;
  text: string;
  op?: string;
}

export interface Chat {
  entries: Entry[];
  // The Maker's reply while it streams.
  partial?: Message;
  running: boolean;
  pending: Pending[];
  // Operations the Talker has taken (or dropped), in case the news beats the POST's answer.
  taken: string[];
  // How the last turn ended, when it didn't answer. Live only: a snapshot doesn't say.
  ended?: "stopped" | "failed";
  // The Talker's build call while it runs (#148): its step labels so far, and when the app first saw it.
  build?: { callId: string; output: string; since: number };
}

export const NEW_CHAT: Chat = {
  entries: [],
  pending: [],
  running: false,
  taken: [],
};

export type Action =
  // `at`: when the frame came in, for the build's timer.
  | { type: "frame"; frame: Frame; at: number }
  | { type: "send"; key: string; text: string }
  | { type: "sent"; key: string; op: string }
  // Refused (Screening) or never delivered: the text goes back to the composer.
  | { type: "unsent"; key: string }
  // Another Draft opened (#149): its snapshot redraws the chat, and a new chat has none.
  | { type: "reset" };

export interface Row {
  key: string;
  who: "creator" | "maker" | "app" | "status" | "card";
  text: string;
  queued?: boolean;
  // The message Try again re-sends.
  retry?: string;
  // The latest game card, which opens Play.
  play?: boolean;
}

const textOf = (message: Message | undefined) => {
  const content = message?.content ?? "";
  return (
    typeof content === "string"
      ? content
      : content
          .map((block) => (block.type === "text" ? block.text : ""))
          .join("")
  ).trim();
};

const queuedCount = (items: { mode: string }[]) =>
  items.filter((item) => item.mode !== "write").length;

// A snapshot carries no submission records, only how many messages are still queued. They are the newest ones sent:
// the Talker takes them in order. ponytail: a message sent while the snapshot was in flight can drop out of view
// until the Talker takes it; snapshots with the inbox's operation ids would close that.
const fromSnapshot = (chat: Chat, snapshot: Snapshot, at: number): Chat => {
  const slot = snapshot.tools?.find(
    (tool) => tool.name === "build" && tool.status !== "done"
  );
  const acked = chat.pending.filter((p) => p.op !== undefined);
  const stillQueued = new Set(
    acked.slice(acked.length - queuedCount(snapshot.inbox))
  );
  return {
    ...chat,
    // ponytail: a snapshot doesn't say when the build started, so a build first seen in one counts from then.
    build: slot && {
      callId: slot.callId,
      output: slot.output ?? "",
      since: chat.build?.callId === slot.callId ? chat.build.since : at,
    },
    ended: undefined,
    entries: snapshot.entries,
    partial: snapshot.generation?.message,
    pending: chat.pending.filter(
      (p) => p.op === undefined || stillQueued.has(p)
    ),
    running: snapshot.run !== undefined,
  };
};

const applyChange = (message: Message, change: Change): Message => {
  if (change.type === "message") {
    return change.message;
  }
  if (change.type === "toolcall_delta") {
    return message;
  }
  const content = [...(message.content as Block[])];
  if (change.type === "text_delta" || change.type === "thinking_delta") {
    const block = content[change.contentIndex];
    const field = change.type === "text_delta" ? "text" : "thinking";
    content[change.contentIndex] = {
      ...block,
      [field]: (block?.[field] ?? "") + change.delta,
    } as Block;
  } else if ("block" in change) {
    content[change.contentIndex] = change.block;
  }
  return { ...message, content };
};

const applyOutput = (output: string, change: ToolOutput | undefined) => {
  if (!change) {
    return output;
  }
  if ("set" in change) {
    return change.set;
  }
  return output.slice(change.trimStart ?? 0) + (change.append ?? "");
};

// Of the tool events, only the build's show: its start, its step labels, its end.
const applyTool = (chat: Chat, event: ToolEvent, at: number): Chat => {
  if (event.type === "tool_execution_start") {
    return event.toolName === "build"
      ? { ...chat, build: { callId: event.toolCallId, output: "", since: at } }
      : chat;
  }
  const { build } = chat;
  if (build?.callId !== event.toolCallId) {
    return chat;
  }
  if (event.type === "tool_execution_end") {
    return { ...chat, build: undefined };
  }
  return {
    ...chat,
    build: { ...build, output: applyOutput(build.output, event.output) },
  };
};

const applyEvent = (chat: Chat, event: AgentEvent, at: number): Chat => {
  if (event.type === "snapshot") {
    // pi replaces batches a slow socket missed with a fresh snapshot.
    return fromSnapshot(chat, event as Snapshot, at);
  }
  let next = chat;
  if ("entry" in event && event.entry) {
    const { entry } = event;
    next = {
      ...next,
      entries: [...next.entries.filter((e) => e.id !== entry.id), entry],
    };
    if (entry.kind === "pi.assistant") {
      next = { ...next, partial: undefined };
    }
  }
  if (event.type === "run_start") {
    return { ...next, ended: undefined, running: true };
  }
  if (event.type === "run_end") {
    return { ...next, build: undefined, partial: undefined, running: false };
  }
  if ("toolCallId" in event) {
    return applyTool(next, event as ToolEvent, at);
  }
  if (event.type === "message_start" && "message" in event) {
    return event.message.role === "assistant"
      ? { ...next, partial: event.message }
      : next;
  }
  if (event.type === "message_update" && "changes" in event && next.partial) {
    let { partial } = next;
    for (const change of event.changes) {
      partial = applyChange(partial, change);
    }
    return { ...next, partial };
  }
  if (event.type === "submission" && "record" in event) {
    const { requestId, status } = event.record;
    if (requestId === undefined || status === "queued") {
      return next;
    }
    return {
      ...next,
      pending: next.pending.filter((p) => p.op !== requestId),
      taken: [...next.taken, requestId],
    };
  }
  return next;
};

const applyFrame = (chat: Chat, frame: Frame, at: number): Chat => {
  if (frame.type === "snapshot") {
    return fromSnapshot(chat, frame.data, at);
  }
  if (frame.type === "turn_failed") {
    // Stop is pi's abort; every other reason reads the same to the Creator (#119).
    return {
      ...chat,
      ended: frame.reason === "aborted" ? "stopped" : "failed",
    };
  }
  let next = chat;
  if (frame.type === "batch") {
    for (const event of frame.data) {
      next = applyEvent(next, event, at);
    }
  }
  return next;
};

export const makerChat = (chat: Chat, action: Action): Chat => {
  switch (action.type) {
    case "frame": {
      return applyFrame(chat, action.frame, action.at);
    }
    case "send": {
      return {
        ...chat,
        pending: [...chat.pending, { key: action.key, text: action.text }],
      };
    }
    case "sent": {
      const { key, op } = action;
      return {
        ...chat,
        pending: chat.taken.includes(op)
          ? chat.pending.filter((p) => p.key !== key)
          : chat.pending.map((p) => (p.key === key ? { ...p, op } : p)),
      };
    }
    case "reset": {
      return NEW_CHAT;
    }
    default: {
      return {
        ...chat,
        pending: chat.pending.filter((p) => p.key !== action.key),
      };
    }
  }
};

const WHO: Record<string, Row["who"]> = {
  "pi.assistant": "maker",
  "pi.user": "creator",
};

// "1:12"
const clock = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

// The build's current step: the last label it passed on. Past steps aren't kept (#119).
const stepOf = (output: string) =>
  output.trim().split("\n").at(-1) || "Building";

// `now` runs the build's timer.
// The title each build call gave its game, by call id.
const buildTitles = (entries: Entry[]) => {
  const titles = new Map<string, string | undefined>();
  for (const entry of entries) {
    const content = entry.model?.[0]?.content;
    for (const block of Array.isArray(content) ? content : []) {
      if (block.type === "toolCall" && block.name === "build") {
        titles.set(block.id ?? "", block.arguments?.title);
      }
    }
  }
  return titles;
};

// A build that answered with its summary: it wrote a Revision. A refusal or failure is an error result.
const revisionOf = (entry: Entry) => {
  const message = entry.model?.[0];
  return entry.kind === "pi.tool-result" &&
    message?.toolName === "build" &&
    !message.isError
    ? message
    : undefined;
};

export const chatView = (chat: Chat, now: number) => {
  const rows: Row[] = [];
  let latest: { row: Row; callId?: string } | undefined;
  for (const entry of chat.entries) {
    const revision = revisionOf(entry);
    if (revision) {
      latest = {
        callId: revision.toolCallId,
        row: { key: `${entry.id}`, text: "Built a new version", who: "card" },
      };
      rows.push(latest.row);
    }
    const who = WHO[entry.kind];
    const text = textOf(entry.model?.[0]);
    if (who && text) {
      rows.push({ key: `${entry.id}`, text, who });
    }
  }
  // Only the latest Revision is kept (no Undo), so only its card plays.
  if (latest) {
    const title = buildTitles(chat.entries).get(latest.callId ?? "");
    latest.row.play = true;
    latest.row.text = `${title ?? "Your game"} · tap to play`;
  }
  const streaming = textOf(chat.partial);
  if (streaming) {
    rows.push({ key: "partial", text: streaming, who: "maker" });
  }
  if (chat.build) {
    const { output, since } = chat.build;
    rows.push({
      key: "status",
      text: `${stepOf(output)} · ${clock(now - since)}`,
      who: "status",
    });
  }
  for (const { key, text } of chat.pending) {
    rows.push({ key: `pending-${key}`, queued: true, text, who: "creator" });
  }
  if (chat.ended === "stopped") {
    rows.push({
      key: "ended",
      text: "Stopped. Your game hasn't changed.",
      who: "app",
    });
  } else if (chat.ended === "failed") {
    rows.push({
      key: "ended",
      retry: rows.findLast((row) => row.who === "creator")?.text,
      text: "Something went wrong. Your game hasn't changed.",
      who: "app",
    });
  }
  return { rows, running: chat.running };
};

// The Revision a preview URL serves: /drafts/<id>/<n>/<exp>.<sig>/index.html (apps/worker/src/api.ts).
const previewRevision = (url: string) =>
  url.match(/\/drafts\/[^/]+\/(?<n>\d+)\//u)?.groups?.n;

// Play's "New version · Reload" pill (#148): the newest preview URL is of a later Revision than the one playing.
export const newVersion = (playing: string | undefined, fresh: string) =>
  playing !== undefined && previewRevision(playing) !== previewRevision(fresh);
