// What the app's socket shows of the agent's messages (ADR 0006): only its reply. A message that calls a tool is a step
// of the work, so its text is a note to itself ("Looks good.", "I didn't playtest the music."), never shown; and text
// streams nowhere, since a message's text can't be told from a note until the message ends. A message cut off by Stop,
// the abort timer or an error is a half-written thought, not a reply, so its text goes too; the turn's failure tells
// the Creator. One cut by the length limit ends its turn as done, so its text is the only reply there is, and stays.
// The transcript the model reads keeps everything.
import type { AgentEvent } from "@earendil-works/pi-durable";

interface Block {
  type: string;
}
interface Message {
  role: string;
  content: string | readonly Block[];
  stopReason?: string;
}

const CUT_OFF = new Set(["aborted", "error"]);

const silent = <M extends Message>(message: M): M =>
  typeof message.content === "string"
    ? message
    : {
        ...message,
        content: message.content.filter((block) => block.type !== "text"),
      };

const replyOnly = <M extends Message>(message: M): M =>
  message.role === "assistant" &&
  typeof message.content !== "string" &&
  (message.content.some((block) => block.type === "toolCall") ||
    CUT_OFF.has(message.stopReason ?? ""))
    ? silent(message)
    : message;

const entry = <E extends { kind: string; model?: readonly Message[] }>(
  record: E
): E =>
  record.kind === "pi.assistant" && record.model
    ? { ...record, model: record.model.map(replyOnly) }
    : record;

// Where each text block of a message sits, so the blocks after them can be renumbered.
const textAt = (message: Message | undefined) =>
  new Set(
    typeof message?.content === "string" || !message
      ? []
      : message.content.flatMap((block, index) =>
          block.type === "text" ? [index] : []
        )
  );

// One socket's view of pi's events. The in-flight message reaches the app without its text blocks, so every change to
// a later block has its contentIndex moved down past them: the app writes a change at content[contentIndex], and a
// stale index would leave a hole in its message. Each message_start, `message` change and snapshot says where the
// text blocks are, and each text_start adds one.
export const creatorView = () => {
  let texts = new Set<number>();
  const shift = (index: number) =>
    index - [...texts].filter((at) => at < index).length;
  return (event: AgentEvent): AgentEvent => {
    if (event.type === "snapshot") {
      const { generation } = event;
      texts = textAt(generation?.message);
      return {
        ...event,
        entries: event.entries.map(entry),
        ...(generation?.message && {
          generation: { ...generation, message: silent(generation.message) },
        }),
      };
    }
    if (event.type === "message_start") {
      if (event.message.role !== "assistant") {
        return event;
      }
      texts = textAt(event.message);
      return { ...event, message: silent(event.message) };
    }
    if (event.type === "message_update") {
      return {
        ...event,
        changes: event.changes.flatMap((change): (typeof change)[] => {
          if (change.type === "message") {
            texts = textAt(change.message);
            return [{ ...change, message: silent(change.message) }];
          }
          if (
            change.type === "text_start" ||
            change.type === "text_delta" ||
            (change.type === "block" && change.block.type === "text")
          ) {
            texts.add(change.contentIndex);
            return [];
          }
          return [{ ...change, contentIndex: shift(change.contentIndex) }];
        }),
      };
    }
    return "entry" in event && event.entry
      ? ({ ...event, entry: entry(event.entry) } as AgentEvent)
      : event;
  };
};
