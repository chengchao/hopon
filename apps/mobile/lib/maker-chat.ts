// The Make tab's chat (#147): a pure function of the Talker's latest snapshot plus the live batches since it
// (apps/worker/src/talker.ts sends pi-durable's events), and of the messages this app has sent but the Talker hasn't
// taken yet. The socket and the screen live in app/create.tsx; this is the part the tests drive.

// The slice of pi-durable's types the chat reads.
interface Block {
  type: string;
  text?: string;
  thinking?: string;
}
interface Message {
  role: string;
  content: string | Block[];
}
interface Entry {
  id: number;
  kind: string;
  model?: Message[];
}
interface Snapshot {
  type: "snapshot";
  entries: Entry[];
  inbox: { mode: string }[];
  run?: unknown;
  generation?: { message?: Message };
}
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
}

export const NEW_CHAT: Chat = {
  entries: [],
  pending: [],
  running: false,
  taken: [],
};

export type Action =
  | { type: "frame"; frame: Frame }
  | { type: "send"; key: string; text: string }
  | { type: "sent"; key: string; op: string }
  // Refused (Screening) or never delivered: the text goes back to the composer.
  | { type: "unsent"; key: string };

export interface Row {
  key: string;
  who: "creator" | "maker" | "app";
  text: string;
  queued?: boolean;
  // The message Try again re-sends.
  retry?: string;
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
const fromSnapshot = (chat: Chat, snapshot: Snapshot): Chat => {
  const acked = chat.pending.filter((p) => p.op !== undefined);
  const stillQueued = new Set(
    acked.slice(acked.length - queuedCount(snapshot.inbox))
  );
  return {
    ...chat,
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

const applyEvent = (chat: Chat, event: AgentEvent): Chat => {
  if (event.type === "snapshot") {
    // pi replaces batches a slow socket missed with a fresh snapshot.
    return fromSnapshot(chat, event as Snapshot);
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
    return { ...next, partial: undefined, running: false };
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

const applyFrame = (chat: Chat, frame: Frame): Chat => {
  if (frame.type === "snapshot") {
    return fromSnapshot(chat, frame.data);
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
      next = applyEvent(next, event);
    }
  }
  return next;
};

export const makerChat = (chat: Chat, action: Action): Chat => {
  switch (action.type) {
    case "frame": {
      return applyFrame(chat, action.frame);
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

export const chatView = (chat: Chat) => {
  const rows: Row[] = [];
  for (const entry of chat.entries) {
    const who = WHO[entry.kind];
    const text = textOf(entry.model?.[0]);
    if (who && text) {
      rows.push({ key: `${entry.id}`, text, who });
    }
  }
  const streaming = textOf(chat.partial);
  if (streaming) {
    rows.push({ key: "partial", text: streaming, who: "maker" });
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
