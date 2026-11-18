import assert from "node:assert/strict";
import { test } from "node:test";

import type { AgentEvent } from "@earendil-works/pi-durable";

import { forCreator } from "./reply.ts";

const assistant = (content: object[]) => ({
  id: 1,
  kind: "pi.assistant",
  model: [{ content, role: "assistant" }],
});
const NOTE = { text: "Looks good, publishing now.", type: "text" };
const CALL = { arguments: {}, id: "t1", name: "build", type: "toolCall" };
const REPLY = { text: "Here's Penguin Slide!", type: "text" };

const shown = (event: object) =>
  forCreator(event as AgentEvent) as unknown as {
    entry: { model: { content: object[] }[] };
  };

test("a message that calls a tool reaches the Creator without its text", () => {
  const { entry } = shown({
    entry: assistant([NOTE, CALL]),
    type: "message_end",
  });
  assert.deepEqual(entry.model[0]?.content, [CALL]);
});

test("the reply after the last tool call reaches the Creator whole", () => {
  const { entry } = shown({ entry: assistant([REPLY]), type: "message_end" });
  assert.deepEqual(entry.model[0]?.content, [REPLY]);
});

test("a snapshot shows the transcript's replies and no streaming text", () => {
  const snapshot = forCreator({
    entries: [assistant([NOTE, CALL]), assistant([REPLY])],
    generation: { attempt: 1, message: { content: [NOTE], role: "assistant" } },
    type: "snapshot",
  } as unknown as AgentEvent) as unknown as {
    entries: { model: { content: object[] }[] }[];
    generation: { message: { content: object[] } };
  };
  assert.deepEqual(
    snapshot.entries.map((each) => each.model[0]?.content),
    [[CALL], [REPLY]]
  );
  assert.deepEqual(snapshot.generation.message.content, []);
});

test("streamed text is dropped, and thinking and tool calls still stream", () => {
  const event = forCreator({
    changes: [
      {
        block: { text: "", type: "text" },
        contentIndex: 0,
        type: "text_start",
      },
      { contentIndex: 0, delta: "Looks", type: "text_delta" },
      { block: NOTE, contentIndex: 0, type: "block" },
      { contentIndex: 1, delta: "hmm", type: "thinking_delta" },
      { block: CALL, contentIndex: 2, type: "toolcall_start" },
    ],
    type: "message_update",
  } as unknown as AgentEvent) as unknown as { changes: { type: string }[] };
  assert.deepEqual(
    event.changes.map((change) => change.type),
    ["thinking_delta", "toolcall_start"]
  );
});

test("the Creator's own messages pass unchanged", () => {
  const user = {
    entry: { id: 2, kind: "pi.user", model: [{ content: "hi", role: "user" }] },
    type: "entry_appended",
  };
  assert.deepEqual(forCreator(user as unknown as AgentEvent), user);
});
