// What the app's socket shows of the agent's messages (ADR 0006): only its reply. A message that calls a tool is a step
// of the work, so its text is a note to itself ("Looks good.", "I didn't playtest the music."), never shown; and text
// streams nowhere, since a message's text can't be told from a note until the message ends. The transcript the model
// reads keeps everything.
import type { AgentEvent } from "@earendil-works/pi-durable";

interface Block {
  type: string;
}
interface Message {
  role: string;
  content: string | readonly Block[];
}

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
  message.content.some((block) => block.type === "toolCall")
    ? silent(message)
    : message;

const entry = <E extends { kind: string; model?: readonly Message[] }>(
  record: E
): E =>
  record.kind === "pi.assistant" && record.model
    ? { ...record, model: record.model.map(replyOnly) }
    : record;

const TEXT = new Set(["text_start", "text_delta"]);

export const forCreator = (event: AgentEvent): AgentEvent => {
  if (event.type === "snapshot") {
    const { generation } = event;
    return {
      ...event,
      entries: event.entries.map(entry),
      ...(generation?.message && {
        generation: { ...generation, message: silent(generation.message) },
      }),
    };
  }
  if (event.type === "message_start") {
    return event.message.role === "assistant"
      ? { ...event, message: silent(event.message) }
      : event;
  }
  if (event.type === "message_update") {
    return {
      ...event,
      changes: event.changes.flatMap((change): (typeof change)[] => {
        if (
          TEXT.has(change.type) ||
          (change.type === "block" && change.block.type === "text")
        ) {
          return [];
        }
        return change.type === "message"
          ? [{ ...change, message: silent(change.message) }]
          : [change];
      }),
    };
  }
  return "entry" in event && event.entry
    ? ({ ...event, entry: entry(event.entry) } as AgentEvent)
    : event;
};
