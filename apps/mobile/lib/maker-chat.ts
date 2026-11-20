// The Make tab's chat (#147): a pure function of the Maker's latest snapshot plus the live batches since it
// (apps/worker/src/maker.ts sends pi-durable's events), and of the messages this app has sent but the Maker hasn't
// taken yet. The socket and the screen live in app/create.tsx; this is the part the tests drive.
import type { DraftSummary } from "@hopon/schemas";

import { t } from "./i18n.ts";

// The slice of pi-durable's types the chat reads.
interface Block {
  type: string;
  text?: string;
  thinking?: string;
  // A toolCall's.
  id?: string;
  name?: string;
  arguments?: {
    command?: string;
    description?: string;
    path?: string;
    title?: string;
  };
}
interface Message {
  role: string;
  content: string | Block[];
  // A user message's, in ms.
  timestamp?: number;
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
  | {
      type: "toolcall_delta";
      contentIndex: number;
      path: (string | number)[];
      delta: string;
    }
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
  // Operations the Maker has taken (or dropped), in case the news beats the POST's answer.
  taken: string[];
  // How the last turn ended, when it didn't answer. Live only: a snapshot doesn't say.
  ended?: "stopped" | "failed" | "resting";
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
          .map((block) => (block?.type === "text" ? block.text : ""))
          .join("")
  ).trim();
};

const queuedCount = (items: { mode: string }[]) =>
  items.filter((item) => item.mode !== "write").length;

// A snapshot carries no submission records, only how many messages are still queued. They are the newest ones sent:
// the Maker takes them in order. ponytail: a message sent while the snapshot was in flight can drop out of view
// until the Maker takes it; snapshots with the inbox's operation ids would close that.
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
  const content = [...(message.content as Block[])];
  // A call's arguments stream in as appends to their string fields; only the top-level ones are read.
  if (change.type === "toolcall_delta") {
    const [field] = change.path;
    const block = content[change.contentIndex];
    if (block && typeof field === "string" && change.path.length === 1) {
      const args: Record<string, unknown> = { ...block.arguments };
      args[field] = `${args[field] ?? ""}${change.delta}`;
      content[change.contentIndex] = { ...block, arguments: args };
    }
    return { ...message, content };
  }
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
    // Stop is pi's abort, and the Maker says "resting" when AI Gateway's credits ran out (ADR 0004); every other
    // reason reads the same to the Creator (#119).
    const ended: Record<string, Chat["ended"]> = {
      aborted: "stopped",
      resting: "resting",
    };
    return { ...chat, ended: ended[frame.reason] ?? "failed" };
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

// What the Maker is doing while a turn runs, so the Creator sees it isn't stuck: the call it is on or still writing,
// by the first row whose pattern its tool name and command (or file path) match; thinking between calls.
const ACTIVITIES: [RegExp, string][] = [
  [/^build /u, t.make.activity.building],
  [/^playtest |tests\.json|vitest|\btsc\b/u, t.make.activity.testing],
  [/music\.py|\.mid\b|\.sf2\b/u, t.make.activity.composing],
  [
    /design\.md|^(?:activate_skill|read_skill_resource|read|ls|grep|find) /u,
    t.make.activity.planning,
  ],
  [/starter\.js/u, t.make.activity.settingUp],
  [/^(?:bash|write|edit) /u, t.make.activity.writing],
];

const callsOf = (message: Message | undefined) =>
  Array.isArray(message?.content)
    ? message.content.filter((block) => block.type === "toolCall")
    : [];

// The turn's newest call without a result: the one streaming in, else the one running. A stopped turn's calls never
// get one, hence only this turn's.
const currentCall = (chat: Chat) => {
  const turn = chat.entries.slice(
    Math.max(
      0,
      chat.entries.findLastIndex((entry) => entry.kind === "pi.user")
    )
  );
  const done = new Set(turn.map((entry) => entry.model?.[0]?.toolCallId));
  const calls = [
    ...turn.flatMap((entry) =>
      entry.kind === "pi.assistant" ? callsOf(entry.model?.[0]) : []
    ),
    ...callsOf(chat.partial),
  ];
  return calls.findLast((call) => !done.has(call.id));
};

const activityOf = (chat: Chat) => {
  const call = currentCall(chat);
  if (!call) {
    return t.make.activity.thinking;
  }
  const subject = `${call.name} ${call.arguments?.command ?? call.arguments?.path ?? ""}`;
  return (
    ACTIVITIES.find(([pattern]) => pattern.test(subject))?.[1] ??
    t.make.activity.working
  );
};

// The turn's timer runs from the Creator's latest message the Maker took, a steer included. A message carries its
// time, so the timer survives a reconnect.
const startedAt = (entries: Entry[]) =>
  entries.findLast((entry) => entry.kind === "pi.user")?.model?.[0]?.timestamp;

// `now` runs the turn's timer.
// The title and description each build call gave its game, by call id.
interface Named {
  description?: string;
  title?: string;
}
const buildNames = (entries: Entry[]) => {
  const names = new Map<string, Named>();
  for (const entry of entries) {
    const content = entry.model?.[0]?.content;
    for (const block of Array.isArray(content) ? content : []) {
      if (block.type === "toolCall" && block.name === "build") {
        names.set(block.id ?? "", block.arguments ?? {});
      }
    }
  }
  return names;
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
        row: { key: `${entry.id}`, text: t.make.built, who: "card" },
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
  const game = latest && buildNames(chat.entries).get(latest.callId ?? "");
  if (latest) {
    latest.row.play = true;
    latest.row.text = t.make.tapToPlay(game?.title ?? t.make.yourGame);
  }
  const streaming = textOf(chat.partial);
  if (streaming) {
    rows.push({ key: "partial", text: streaming, who: "maker" });
  }
  if (chat.running && !streaming) {
    const since = startedAt(chat.entries);
    rows.push({
      key: "status",
      text:
        since === undefined
          ? activityOf(chat)
          : `${activityOf(chat)} · ${clock(now - since)}`,
      who: "status",
    });
  }
  for (const { key, text } of chat.pending) {
    rows.push({ key: `pending-${key}`, queued: true, text, who: "creator" });
  }
  if (chat.ended === "stopped") {
    rows.push({
      key: "ended",
      text: t.make.stopped,
      who: "app",
    });
  } else if (chat.ended) {
    rows.push({
      key: "ended",
      retry: rows.findLast((row) => row.who === "creator")?.text,
      text: chat.ended === "resting" ? t.make.resting : t.make.failed,
      who: "app",
    });
  }
  return { game, rows, running: chat.running };
};

// The Revision a preview URL serves: /drafts/<id>/<n>/<exp>.<sig>/index.html (apps/worker/src/api.ts).
const previewRevision = (url: string) =>
  url.match(/\/drafts\/[^/]+\/(?<n>\d+)\//u)?.groups?.n;

// Play's "New version · Reload" pill (#148): the newest preview URL is of a later Revision than the one playing.
export const newRevision = (playing: string | undefined, fresh: string) =>
  playing !== undefined && previewRevision(playing) !== previewRevision(fresh);

// The open Draft as its chat shows it: its latest card's title and description. The Draft list reads them from D1 only
// on opening and at a turn_done the socket may have missed, so it can still say New game under a game card.
export const shownDraft = (
  draft: DraftSummary | null | undefined,
  game: Named | undefined
) =>
  draft && game?.title
    ? {
        ...draft,
        description: game.description ?? draft.description,
        title: game.title,
      }
    : draft;

// Publish (#119): once the Draft has a Revision, which the Maker titles, and no turn is running.
export const publishable = (
  draft: DraftSummary | null | undefined,
  view: { running: boolean }
) => !!draft?.title && !view.running;
