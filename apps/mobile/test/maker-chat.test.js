import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chatView,
  makerChat,
  NEW_CHAT,
  newRevision,
  publishable,
  shownDraft,
} from "../lib/maker-chat.ts";

// pi's frames as the Maker sends them (apps/worker/src/maker.ts).
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
    "status: Thinking",
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
    "status: Thinking",
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
    ["creator: A cat game", "creator: Make it blue", "status: Thinking"]
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
    ["creator: A cat game", "status: Thinking"]
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
    ).at(-2),
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
    "status: Thinking",
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

// A turn's progress: the Creator's message (its time starts the timer), and the Maker's calls as pi streams them.
const asked = (id, text, timestamp) => ({
  id,
  kind: "pi.user",
  model: [{ content: [{ text, type: "text" }], role: "user", timestamp }],
});
const call = (id, callId, name, args) => ({
  id,
  kind: "pi.assistant",
  model: [
    {
      content: [{ arguments: args, id: callId, name, type: "toolCall" }],
      role: "assistant",
    },
  ],
});
const result = (id, callId) => ({
  id,
  kind: "pi.tool-result",
  model: [{ content: [], role: "toolResult", toolCallId: callId }],
});
const statusOf = (chat, now) =>
  chatView(chat, now).rows.find((row) => row.who === "status")?.text;
const chatOf = (...actions) => {
  let chat = NEW_CHAT;
  for (const action of actions) {
    chat = makerChat(chat, action);
  }
  return chat;
};

test("while a turn runs, a status row says what the Maker is doing and how long the turn has taken", () => {
  const start = [
    snapshot({ entries: [asked(1, "A sailing game", 10_000)], run: {} }),
  ];
  assert.equal(statusOf(chatOf(...start), 10_000), "Thinking · 0:00");
  // A call shows while its arguments still stream in.
  const writing = [
    ...start,
    batch({
      message: { content: [], role: "assistant" },
      type: "message_start",
    }),
    batch({
      changes: [
        {
          block: { arguments: {}, id: "c1", name: "bash", type: "toolCall" },
          contentIndex: 0,
          type: "toolcall_start",
        },
        {
          contentIndex: 0,
          delta: "cd /workspace && cat > design.md <<'EOF'",
          path: ["command"],
          type: "toolcall_delta",
        },
      ],
      type: "message_update",
    }),
  ];
  assert.equal(
    statusOf(chatOf(...writing), 15_000),
    "Planning the game · 0:05"
  );
  const turn = [
    ...start,
    batch({
      entry: call(2, "c1", "bash", { command: "cat > design.md <<'EOF'" }),
      type: "message_end",
    }),
    batch({ entry: result(3, "c1"), type: "tool_execution_end" }),
  ];
  // Between calls, it thinks.
  assert.equal(statusOf(chatOf(...turn), 20_000), "Thinking · 0:10");
  const steps = [
    ["bash", { command: "node /opt/hopon/starter.js" }, "Setting up"],
    [
      "bash",
      { command: "cd src && cat > play.ts <<'EOF'" },
      "Writing the game",
    ],
    ["bash", { command: "sed -i 's/230/252/' tests.json" }, "Testing"],
    ["playtest", { inputs: [] }, "Testing"],
    ["bash", { command: "python3 music.py" }, "Composing music"],
    [
      "read_skill_resource",
      { path: "references/phaser.md" },
      "Planning the game",
    ],
    ["bash", { command: "ls" }, "Writing the game"],
    ["design_game", {}, "Designing the game"],
    ["ask_advisor", { question: "?" }, "Checking the game"],
    ["search", { query: "?" }, "Working"],
    ["build", { title: "Seven Ports" }, "Building"],
  ];
  for (const [index, [name, args, label]] of steps.entries()) {
    const id = 10 + index * 2;
    turn.push(
      batch({ entry: call(id, `s${id}`, name, args), type: "message_end" })
    );
    assert.equal(statusOf(chatOf(...turn), 82_000), `${label} · 1:12`);
    turn.push(
      batch({ entry: result(id + 1, `s${id}`), type: "tool_execution_end" })
    );
  }
  // The Maker's words are the news while they stream, and the turn's end clears the row.
  const replying = [
    ...turn,
    batch({
      message: {
        content: [{ text: "Seven Ports is ready", type: "text" }],
        role: "assistant",
      },
      type: "message_start",
    }),
  ];
  assert.equal(statusOf(chatOf(...replying), 90_000), undefined);
  assert.equal(
    statusOf(chatOf(...turn, batch({ type: "run_end" })), 90_000),
    undefined
  );
});

test("a turn running at connect shows its call and keeps its timer; a stopped turn's call doesn't carry over", () => {
  const entries = [
    asked(1, "A sailing game", 0),
    call(2, "c1", "build", { title: "Seven Ports" }),
  ];
  assert.equal(
    statusOf(chatOf(snapshot({ entries, run: {} })), 72_000),
    "Building · 1:12"
  );
  // Stopped mid-build, the call has no result; the next turn thinks.
  const next = snapshot({
    entries: [...entries, asked(3, "Bigger ships", 100_000)],
    run: {},
  });
  assert.equal(statusOf(chatOf(next), 101_000), "Thinking · 0:01");
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
          `The weekly Allowance is used up. Tell the Creator: "You've used this week's hopon tokens. They come back when the week resets."`,
          true
        ),
        maker(
          8,
          "You've used this week's hopon tokens. They come back when the week resets."
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
    "maker: You've used this week's hopon tokens. They come back when the week resets.",
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

test("a game card names the Draft and opens Publish even when the Draft list still has no title", () => {
  // The Draft list was read before the build, and the socket dropped through the turn_done that rereads it.
  const untitled = { description: null, id: "d", title: null };
  const built = view(
    snapshot({
      entries: [
        user(1, "A trading game at sea"),
        buildCall(2, "call-1", "Great Voyage"),
        buildResult(3, "call-1", "Built it."),
        maker(4, "Here it is!"),
      ],
    })
  );
  const shown = shownDraft(untitled, built.game);
  assert.equal(shown.title, "Great Voyage");
  assert.equal(publishable(shown, built), true);
  // Before any build, the Draft is as the list has it.
  const chat = view(snapshot({ entries: [user(1, "Hi")] }));
  assert.equal(shownDraft(untitled, chat.game), untitled);
  assert.equal(publishable(shownDraft(untitled, chat.game), chat), false);
});

// The chat's rows after the Creator's message.
const steps = (chat, now) =>
  chatView(chat, now)
    .rows.filter((row) => row.who !== "creator")
    .map((row) => `${row.who}: ${row.text}`);

test("each finished stretch of the Maker's work stays in the chat as a step", () => {
  const entries = [
    asked(1, "A sailing game", 0),
    call(2, "c1", "design_game", {}),
    result(3, "c1"),
    // Looking something up is no step, and two calls of one activity are one step.
    call(4, "c2", "read_skill_resource", { path: "references/phaser.md" }),
    result(5, "c2"),
    call(6, "c3", "write", { path: "src/play.ts" }),
    result(7, "c3"),
    call(8, "c4", "read", { path: "src/panels.tsx" }),
    result(9, "c4"),
    call(10, "c5", "write", { path: "src/art.ts" }),
    result(11, "c5"),
    call(12, "c6", "playtest", { inputs: [] }),
    result(13, "c6"),
    call(14, "c7", "write", { path: "src/play.ts" }),
  ];
  // The Maker is writing again: the steps before it stay, and the status row is the one it is on.
  assert.deepEqual(steps(chatOf(snapshot({ entries, run: {} })), 430_000), [
    "step: Designed the game",
    "step: Wrote the game",
    "step: Tested",
    "status: Writing the game · 7:10",
  ]);
  // Its last step isn't over while it is still on it: the status row says so.
  const testing = [...entries.slice(0, 11), call(12, "c6", "playtest", {})];
  assert.deepEqual(
    steps(chatOf(snapshot({ entries: testing, run: {} })), 410_000),
    [
      "step: Designed the game",
      "step: Wrote the game",
      "status: Testing · 6:50",
    ]
  );
  const writing = [...entries.slice(0, 7), call(8, "c5", "write", {})];
  assert.deepEqual(
    steps(chatOf(snapshot({ entries: writing, run: {} })), 310_000),
    ["step: Designed the game", "status: Writing the game · 5:10"]
  );
  // After the turn, every step is still there, above the game's card and the Maker's reply. A call that failed is
  // no step.
  const done = [
    ...entries.slice(0, 13),
    call(14, "c7", "ask_advisor", { question: "Done check." }),
    {
      ...result(15, "c7"),
      model: [{ ...result(15, "c7").model[0], isError: true }],
    },
    call(16, "c8", "bash", { command: "python3 music.py" }),
    result(17, "c8"),
    call(18, "c9", "ask_advisor", { question: "Done check." }),
    result(19, "c9"),
    buildCall(20, "c10", "Seven Ports"),
    buildResult(21, "c10", "Built Seven Ports."),
    maker(22, "Seven Ports is ready."),
  ];
  assert.deepEqual(steps(chatOf(snapshot({ entries: done })), 900_000), [
    "step: Designed the game",
    "step: Wrote the game",
    "step: Tested",
    "step: Composed music",
    "step: Checked the game",
    // buildCall's message has words too.
    "maker: On it!",
    "card: Seven Ports · tap to play",
    "maker: Seven Ports is ready.",
  ]);
});
