// The Maker's socket filter (src/reply.ts) as an installed app reads it: pi's events through creatorView, then through
// the app's own chat reducer (apps/mobile/lib/maker-chat.ts). A text block the filter drops must not leave a hole in the
// app's streaming message, or the Make screen throws mid-turn.
import assert from "node:assert/strict";
import { test } from "node:test";

import { chatView, makerChat, NEW_CHAT } from "../../mobile/lib/maker-chat.ts";
import { creatorView } from "../src/reply.ts";

const NOTE = "Looks good, publishing now.";
const call = (id, title) => ({
  arguments: title ? { title } : {},
  id,
  name: "build",
  type: "toolCall",
});
const STARTS = { text: "text_start", thinking: "thinking_start" };
const start = (contentIndex, block) => ({
  block,
  contentIndex,
  type: STARTS[block.type] ?? "toolcall_start",
});
const update = (...changes) => ({ changes, type: "message_update" });
const begin = (content = []) => ({
  message: { content, role: "assistant" },
  type: "message_start",
});

// The app's chat after each event, which must render; the last chat is returned.
const play = (events, view = creatorView()) => {
  let chat = NEW_CHAT;
  for (const event of events) {
    chat = makerChat(chat, {
      at: 0,
      frame:
        event.type === "snapshot"
          ? { data: view(event), type: "snapshot" }
          : { data: [view(event)], type: "batch" },
      type: "frame",
    });
    const rendered = chat;
    assert.doesNotThrow(() => chatView(rendered, 0), `after ${event.type}`);
  }
  return chat;
};
const blocks = (chat) => chat.partial?.content;

test("text then a tool call: the app's message holds the call, with no hole", () => {
  const chat = play([
    { inputs: [], type: "run_start" },
    begin(),
    update(start(0, { text: "", type: "text" })),
    update({ contentIndex: 0, delta: NOTE, type: "text_delta" }),
    update(start(1, call("c1"))),
    update({ block: call("c1", "Moon Cat"), contentIndex: 1, type: "block" }),
  ]);
  assert.deepEqual(blocks(chat), [call("c1", "Moon Cat")]);
  assert.ok(!JSON.stringify(chat).includes(NOTE));
});

test("thinking, text, then a tool call", () => {
  const chat = play([
    begin(),
    update(start(0, { thinking: "", type: "thinking" })),
    update({ contentIndex: 0, delta: "hmm", type: "thinking_delta" }),
    update(start(1, { text: "", type: "text" })),
    update({ contentIndex: 1, delta: NOTE, type: "text_delta" }),
    update(start(2, call("c1")), {
      contentIndex: 2,
      delta: "{",
      path: ["title"],
      type: "toolcall_delta",
    }),
    update({ block: call("c1", "Moon Cat"), contentIndex: 2, type: "block" }),
    update({ contentIndex: 0, delta: "!", type: "thinking_delta" }),
  ]);
  assert.deepEqual(blocks(chat), [
    { thinking: "hmm!", type: "thinking" },
    call("c1", "Moon Cat"),
  ]);
});

test("parallel tool calls around notes", () => {
  const chat = play([
    begin(),
    update(
      start(0, { text: "", type: "text" }),
      start(1, call("c1")),
      start(2, { text: "", type: "text" }),
      start(3, call("c2"))
    ),
    update(
      { block: call("c1", "A"), contentIndex: 1, type: "block" },
      { block: call("c2", "B"), contentIndex: 3, type: "block" }
    ),
  ]);
  assert.deepEqual(blocks(chat), [call("c1", "A"), call("c2", "B")]);
});

test("a snapshot taken mid-message, then more changes", () => {
  const view = creatorView();
  const partial = [
    { thinking: "hmm", type: "thinking" },
    { text: NOTE, type: "text" },
    call("c1"),
  ];
  const chat = play(
    [
      {
        agent: {},
        compactions: [],
        entries: [],
        generation: {
          attempt: 1,
          message: { content: partial, role: "assistant" },
        },
        inbox: [],
        nestedTools: [],
        run: { inputs: [] },
        tools: [],
        type: "snapshot",
        usage: {},
      },
      update({ block: call("c1", "Moon Cat"), contentIndex: 2, type: "block" }),
      update(start(3, call("c2"))),
    ],
    view
  );
  assert.deepEqual(blocks(chat), [
    { thinking: "hmm", type: "thinking" },
    call("c1", "Moon Cat"),
    call("c2"),
  ]);
});

test("a whole-message change resets where the text blocks are", () => {
  const chat = play([
    begin([{ text: NOTE, type: "text" }]),
    update({
      message: {
        content: [{ text: NOTE, type: "text" }, call("c1")],
        role: "assistant",
      },
      type: "message",
    }),
    update({ block: call("c1", "Moon Cat"), contentIndex: 1, type: "block" }),
  ]);
  assert.deepEqual(blocks(chat), [call("c1", "Moon Cat")]);
});

const ended = (id, stopReason, text) => ({
  entry: {
    id,
    kind: "pi.assistant",
    model: [
      { content: [{ text, type: "text" }], role: "assistant", stopReason },
    ],
  },
  type: "message_end",
});

test("a reply cut off by Stop or an error shows nothing; a finished one shows", () => {
  const half = "Now let me fix the collision";
  const chat = play([
    ended(1, "aborted", half),
    ended(2, "error", half),
    ended(3, "stop", "Here's Moon Cat!"),
  ]);
  const texts = chatView(chat, 0).rows.map((row) => row.text);
  assert.deepEqual(texts, ["Here's Moon Cat!"]);
});

test("a reply cut by the length limit shows what it said", () => {
  const cut = "Here's Moon Cat! Tap to jump over the";
  const texts = chatView(play([ended(1, "length", cut)]), 0).rows.map(
    (row) => row.text
  );
  assert.deepEqual(texts, [cut]);
});
