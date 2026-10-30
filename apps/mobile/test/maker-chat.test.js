import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chatView,
  makerChat,
  NEW_CHAT,
  newRevision,
  publishable,
} from "../lib/maker-chat.ts";

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

test("out of AI Gateway credits, the Maker is resting, and Try again re-sends the message", () => {
  const failed = view(
    snapshot({ entries: [user(1, "A cat game")] }),
    frame({ id: 1, reason: "resting", type: "turn_failed" })
  );
  assert.deepEqual(
    lines(failed).at(-1),
    "app: The Maker is resting. Try again later."
  );
  assert.equal(failed.rows.at(-1).retry, "A cat game");
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

// A build (#148): pi's tool events for the Talker's `build` call, whose running output is the Coder's step labels.
const buildStart = (callId = "call-1") => ({
  args: { brief: "", music: null, title: "Moon Cat" },
  toolCallId: callId,
  toolName: "build",
  type: "tool_execution_start",
});
const buildOutput = (output, callId = "call-1") => ({
  output,
  toolCallId: callId,
  toolName: "build",
  type: "tool_execution_update",
});
// The time the app took the frame in.
const at = (ms, action) => ({ ...action, at: ms });
const statusOf = (v) => v.rows.find((row) => row.who === "status")?.text;
const chatOf = (...actions) => {
  let chat = NEW_CHAT;
  for (const action of actions) {
    chat = makerChat(chat, action);
  }
  return chat;
};

test("while build runs, one status row under the Maker's bubble shows the current step and a timer", () => {
  const building = [
    snapshot({ entries: [user(1, "A cat on the moon")], run: {} }),
    batch({ entry: maker(2, "On it!"), type: "message_end" }),
    at(1000, batch(buildStart())),
  ];
  assert.equal(
    statusOf(chatView(chatOf(...building), 1000)),
    "Building · 0:00"
  );
  const stepped = [
    ...building,
    batch(buildOutput({ append: "Writing the game\n" })),
    batch(buildOutput({ append: "Playtesting\n" })),
  ];
  assert.deepEqual(lines(chatView(chatOf(...stepped), 73_000)), [
    "creator: A cat on the moon",
    "maker: On it!",
    "status: Playtesting · 1:12",
  ]);
  // pi trims its retained window from the front, or replaces it.
  const trimmed = [
    ...stepped,
    batch(buildOutput({ append: "Fixing the game\n", trimStart: 17 })),
  ];
  assert.equal(
    statusOf(chatView(chatOf(...trimmed), 73_000)),
    "Fixing the game · 1:12"
  );
  assert.equal(
    statusOf(
      chatView(
        chatOf(...trimmed, batch(buildOutput({ set: "Writing music\n" }))),
        73_000
      )
    ),
    "Writing music · 1:12"
  );
  // It goes when the build ends.
  const ended = batch({
    toolCallId: "call-1",
    toolName: "build",
    type: "tool_execution_end",
  });
  assert.equal(
    statusOf(chatView(chatOf(...trimmed, ended), 80_000)),
    undefined
  );
});

test("a build running at connect shows its step; a reconnect keeps the timer, and the turn's end clears it", () => {
  const connected = snapshot({
    entries: [user(1, "A cat game")],
    run: {},
    tools: [
      {
        callId: "call-1",
        name: "build",
        output: "Writing the game\nPlaytesting\n",
        status: "running",
      },
    ],
  });
  // The snapshot doesn't say when the build started, so the timer counts from the connect.
  const first = at(5000, connected);
  assert.equal(statusOf(chatView(chatOf(first), 9000)), "Playtesting · 0:04");
  const again = at(20_000, connected);
  assert.equal(
    statusOf(chatView(chatOf(first, again), 21_000)),
    "Playtesting · 0:16"
  );
  assert.equal(
    statusOf(
      chatView(
        chatOf(first, again, batch({ inputs: [1], type: "run_end" })),
        22_000
      )
    ),
    undefined
  );
});

// The Maker's call to `build`, and pi's entry for its result.
const buildCall = (id, callId, title) => ({
  id,
  kind: "pi.assistant",
  model: [
    {
      content: [
        { text: "On it!", type: "text" },
        {
          arguments: { brief: "", music: null, title },
          id: callId,
          name: "build",
          type: "toolCall",
        },
      ],
      role: "assistant",
    },
  ],
});
const buildResult = (id, callId, text, isError = false) => ({
  id,
  kind: "pi.tool-result",
  model: [
    {
      content: [{ text, type: "text" }],
      isError,
      role: "toolResult",
      toolCallId: callId,
      toolName: "build",
    },
  ],
});

test("a build that makes a Revision drops a game card; only the latest plays, older ones read Built a new version", () => {
  const first = [
    user(1, "A cat on the moon"),
    buildCall(2, "call-1", "Moon Cat"),
    buildResult(3, "call-1", "Built a moon cat game."),
    maker(4, "Here it is!"),
  ];
  const one = view(snapshot({ entries: first }));
  assert.deepEqual(lines(one), [
    "creator: A cat on the moon",
    "maker: On it!",
    "card: Moon Cat · tap to play",
    "maker: Here it is!",
  ]);
  assert.equal(one.rows[2].play, true);
  const two = view(
    snapshot({
      entries: [
        ...first,
        user(5, "Make it a dog"),
        buildCall(6, "call-2", "Moon Dog"),
        buildResult(7, "call-2", "Made it a dog."),
      ],
    })
  );
  assert.deepEqual(lines(two).slice(2), [
    "card: Built a new version",
    "maker: Here it is!",
    "creator: Make it a dog",
    "maker: On it!",
    "card: Moon Dog · tap to play",
  ]);
  assert.deepEqual(
    two.rows.filter((row) => row.play).map((row) => row.text),
    ["Moon Dog · tap to play"]
  );
});

test("a build that fails, is busy or finds the Allowance used up drops no card; the Maker's reply says so", () => {
  const v = view(
    snapshot({
      entries: [
        user(1, "A cat on the moon"),
        buildCall(2, "call-1", "Moon Cat"),
        buildResult(
          3,
          "call-1",
          'The coder is busy. Tell the Creator: "The Maker is busy. Try again in a minute."',
          true
        ),
        maker(4, "The Maker is busy. Try again in a minute."),
        user(5, "Again"),
        buildCall(6, "call-2", "Moon Cat"),
        buildResult(
          7,
          "call-2",
          `The weekly Allowance is used up. Tell the Creator: "You've used this week's hopon tokens. They come back on Monday."`,
          true
        ),
        maker(
          8,
          "You've used this week's hopon tokens. They come back on Monday."
        ),
      ],
    })
  );
  assert.deepEqual(lines(v), [
    "creator: A cat on the moon",
    "maker: On it!",
    "maker: The Maker is busy. Try again in a minute.",
    "creator: Again",
    "maker: On it!",
    "maker: You've used this week's hopon tokens. They come back on Monday.",
  ]);
});

// What GET /api/drafts/:id/preview answers: /drafts/<id>/<n>/<exp>.<sig>/index.html
const preview = (n, exp) =>
  `https://hopon.example/drafts/d1/${n}/${exp}.c2lnbmF0dXJl/index.html`;

test("Play shows the Reload pill only when a newer Revision than the one playing has landed", () => {
  // Before the game loads, and on a turn that built nothing (a fresh link to the same Revision).
  assert.equal(newRevision(undefined, preview(1, 100)), false);
  assert.equal(newRevision(preview(1, 100), preview(1, 160)), false);
  assert.equal(newRevision(preview(1, 100), preview(2, 160)), true);
  assert.equal(newRevision(preview(9, 100), preview(10, 160)), true);
});

test("Publish waits for a Revision (the Maker's title) and for the turn to end", () => {
  const titled = { description: "Tap to jump.", id: "d", title: "Moon Cat" };
  const untitled = { ...titled, description: null, title: null };
  const start = snapshot({ entries: [maker(1, "Hi!")] });
  const turn = batch({ inputs: [7], type: "run_start" });
  const done = batch({ type: "run_end" });
  assert.equal(publishable(undefined, view(start)), false);
  assert.equal(publishable(untitled, view(start)), false);
  assert.equal(publishable(titled, view(start, turn)), false);
  assert.equal(publishable(titled, view(start, turn, done)), true);
});
