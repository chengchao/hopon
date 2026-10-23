import assert from "node:assert/strict";
import { test } from "node:test";

import { chatView, makerChat, NEW_CHAT } from "../lib/maker-chat.ts";

// pi's frames as the Talker sends them (apps/worker/src/talker.ts).
const user = (id, text) => ({
  id,
  kind: "pi.user",
  model: [{ content: [{ text, type: "text" }], role: "user" }],
});
const maker = (id, text) => ({
  id,
  kind: "pi.assistant",
  model: [
    {
      content: [
        { thinking: "hmm", type: "thinking" },
        { text, type: "text" },
      ],
      role: "assistant",
      stopReason: "stop",
    },
  ],
});
const snapshot = (data) => ({
  frame: {
    data: { entries: [], inbox: [], tools: [], type: "snapshot", ...data },
    type: "snapshot",
  },
  type: "frame",
});
const batch = (...events) => ({
  frame: { data: events, type: "batch" },
  type: "frame",
});
const view = (...actions) => {
  let chat = NEW_CHAT;
  for (const action of actions) {
    chat = makerChat(chat, action);
  }
  return chatView(chat);
};
const lines = (v) =>
  v.rows.map((row) =>
    row.who === "creator" && row.queued
      ? `${row.who} (Queued): ${row.text}`
      : `${row.who}: ${row.text}`
  );

test("a snapshot alone draws the transcript, with the Maker's words and no tool results", () => {
  const v = view(
    snapshot({
      entries: [
        user(1, "A cat on the moon"),
        maker(2, "On it!"),
        {
          id: 3,
          kind: "pi.tool-result",
          model: [{ content: [], role: "toolResult" }],
        },
        maker(4, "Here it is."),
      ],
    })
  );
  assert.deepEqual(lines(v), [
    "creator: A cat on the moon",
    "maker: On it!",
    "maker: Here it is.",
  ]);
  assert.equal(v.running, false);
});

test("batches stream the Maker's reply into its bubble, and the turn's end settles it", () => {
  const start = [
    snapshot({ entries: [maker(1, "Hi!")] }),
    batch(
      { inputs: [7], type: "run_start" },
      { message: user(2, "Make it faster").model[0], type: "message_start" },
      { entry: user(2, "Make it faster"), type: "message_end" },
      { message: { content: [], role: "assistant" }, type: "message_start" }
    ),
    batch({
      changes: [
        {
          block: { text: "", type: "text" },
          contentIndex: 0,
          type: "text_start",
        },
        { contentIndex: 0, delta: "Speeding ", type: "text_delta" },
      ],
      type: "message_update",
    }),
    batch({
      changes: [{ contentIndex: 0, delta: "it up.", type: "text_delta" }],
      type: "message_update",
    }),
  ];
  const streaming = view(...start);
  assert.deepEqual(lines(streaming), [
    "maker: Hi!",
    "creator: Make it faster",
    "maker: Speeding it up.",
  ]);
  assert.equal(streaming.running, true);
  const done = view(
    ...start,
    batch(
      { entry: maker(3, "Speeding it up. Done!"), type: "message_end" },
      { inputs: [7], type: "run_end" }
    ),
    { frame: { id: 7, type: "turn_done" }, type: "frame" }
  );
  assert.deepEqual(lines(done), [
    "maker: Hi!",
    "creator: Make it faster",
    "maker: Speeding it up. Done!",
  ]);
  assert.equal(done.running, false);
});

test("a turn running at connect shows its partial reply, and a tick changes nothing", () => {
  const v = view(
    snapshot({
      entries: [user(1, "A cat game")],
      generation: {
        attempt: 1,
        message: {
          content: [{ text: "Making it", type: "text" }],
          role: "assistant",
        },
      },
      run: { inputs: [1] },
    }),
    { frame: { type: "tick" }, type: "frame" }
  );
  assert.deepEqual(lines(v), ["creator: A cat game", "maker: Making it"]);
  assert.equal(v.running, true);
});

const submission = (requestId, status, id = 9) => ({
  record: { id, requestId, status, type: "input" },
  type: "submission",
});
const inbox = (...ids) => ({
  items: ids.map((id) => ({ id, mode: "steer" })),
  type: "inbox_update",
});

test("a steer shows Queued until the Talker takes it", () => {
  const running = snapshot({ entries: [user(1, "A cat game")], run: {} });
  const sent = [
    running,
    { key: "a", text: "Make it blue", type: "send" },
    { key: "a", op: "op-a", type: "sent" },
    batch(submission("op-a", "queued"), inbox(9)),
  ];
  assert.deepEqual(lines(view(...sent)), [
    "creator: A cat game",
    "creator (Queued): Make it blue",
  ]);
  const taken = view(
    ...sent,
    batch(
      { entry: user(2, "Make it blue"), type: "message_end" },
      submission("op-a", "placed"),
      inbox()
    )
  );
  assert.deepEqual(lines(taken), [
    "creator: A cat game",
    "creator: Make it blue",
  ]);
  // The Talker can take it before the POST's answer reaches the app.
  assert.deepEqual(
    lines(
      view(
        running,
        { key: "a", text: "Make it blue", type: "send" },
        batch(
          { entry: user(2, "Make it blue"), type: "message_end" },
          submission("op-a", "placed")
        ),
        { key: "a", op: "op-a", type: "sent" }
      )
    ),
    ["creator: A cat game", "creator: Make it blue"]
  );
  // A message Screening refused never joins the chat.
  assert.deepEqual(
    lines(
      view(
        running,
        { key: "a", text: "Something rude", type: "send" },
        { key: "a", type: "unsent" }
      )
    ),
    ["creator: A cat game"]
  );
});

const frame = (data) => ({ frame: data, type: "frame" });

test("turn_failed says the game hasn't changed, and Try again re-sends the last message", () => {
  const turn = [
    snapshot({ entries: [user(1, "A cat game"), maker(2, "Sure!")] }),
    batch({ inputs: [3], type: "run_start" }),
    batch(
      { entry: user(3, "Make it faster"), type: "message_end" },
      { inputs: [3], type: "run_end" }
    ),
  ];
  const failed = view(
    ...turn,
    frame({ id: 3, reason: "model_error", type: "turn_failed" })
  );
  assert.deepEqual(lines(failed).slice(2), [
    "creator: Make it faster",
    "app: Something went wrong. Your game hasn't changed.",
  ]);
  assert.equal(failed.rows.at(-1).retry, "Make it faster");
  // The next turn clears it.
  assert.deepEqual(
    lines(
      view(
        ...turn,
        frame({ id: 3, reason: "model_error", type: "turn_failed" }),
        batch({ inputs: [4], type: "run_start" })
      )
    ).at(-1),
    "creator: Make it faster"
  );
});

test("Stop ends the turn with Stopped, and drops the messages queued behind it", () => {
  const v = view(
    snapshot({ entries: [user(1, "A cat game")], run: {} }),
    { key: "a", text: "Make it blue", type: "send" },
    { key: "a", op: "op-a", type: "sent" },
    batch(submission("op-a", "queued"), inbox(9)),
    batch(
      { inputs: [1], type: "run_end" },
      submission("op-a", "unanswered"),
      inbox()
    ),
    frame({ id: 1, reason: "aborted", type: "turn_failed" }),
    frame({ id: 9, reason: "aborted", type: "turn_failed" })
  );
  assert.deepEqual(lines(v), [
    "creator: A cat game",
    "app: Stopped. Your game hasn't changed.",
  ]);
  assert.equal(v.rows.at(-1).retry, undefined);
  assert.equal(v.running, false);
});

test("a reconnect snapshot replaces the view; of the messages sent, those still queued stay", () => {
  const v = view(
    snapshot({ entries: [user(1, "A cat game")], run: {} }),
    batch({
      message: {
        content: [{ text: "Half a repl", type: "text" }],
        role: "assistant",
      },
      type: "message_start",
    }),
    frame({ id: 1, reason: "model_error", type: "turn_failed" }),
    { key: "a", text: "Make it blue", type: "send" },
    { key: "a", op: "op-a", type: "sent" },
    { key: "b", text: "And bigger", type: "send" },
    { key: "b", op: "op-b", type: "sent" },
    { key: "c", text: "And louder", type: "send" },
    // Away: the Talker answered, took "Make it blue" and is working on it, with "And bigger" queued.
    snapshot({
      entries: [
        user(1, "A cat game"),
        maker(2, "Here's your cat game."),
        user(3, "Make it blue"),
      ],
      inbox: [{ id: 8, mode: "steer" }],
      run: { inputs: [3] },
    })
  );
  assert.deepEqual(lines(v), [
    "creator: A cat game",
    "maker: Here's your cat game.",
    "creator: Make it blue",
    "creator (Queued): And bigger",
    "creator (Queued): And louder",
  ]);
  assert.equal(v.running, true);
});

test("switching to another Draft starts from an empty chat, until its snapshot draws it", () => {
  const v = view(
    snapshot({
      entries: [user(1, "A cat game"), maker(2, "On it!")],
      run: { inputs: [1] },
    }),
    { key: "a", text: "Make it blue", type: "send" },
    frame({ id: 1, reason: "model_error", type: "turn_failed" }),
    { type: "reset" }
  );
  assert.deepEqual(lines(v), []);
  assert.equal(v.running, false);
});
