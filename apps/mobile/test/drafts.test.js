import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_DRAFTS } from "@hopon/schemas";

import {
  ago,
  draftCard,
  draftPage,
  draftStatus,
  draftToOpen,
  isFull,
  isWorking,
  listedFacts,
  liveFacts,
} from "../lib/drafts.ts";
import { chatView, makerChat, NEW_CHAT } from "../lib/maker-chat.ts";

const NOW = Date.parse("2026-10-23T12:00:00.000Z");

test("a Draft's time reads as how long ago it changed", () => {
  assert.equal(ago("2026-10-23T11:59:30.000Z", NOW), "just now");
  assert.equal(ago("2026-10-23T11:55:00.000Z", NOW), "5 min ago");
  assert.equal(ago("2026-10-23T10:00:00.000Z", NOW), "2 h ago");
  assert.equal(ago("2026-10-20T12:00:00.000Z", NOW), "3 d ago");
});

// A Draft as GET /api/drafts lists it: changed two hours ago, with no game and no turn unless `over` says so.
const draft = (over = {}) => ({
  description: null,
  id: "d1",
  title: null,
  turnStartedAt: null,
  updatedAt: "2026-10-23T10:00:00.000Z",
  ...over,
});
const GAME = { description: "A cat on the moon.", title: "Moon Cat" };
const TURN = { turnStartedAt: "2026-10-23T11:56:48.000Z" };

test("a Draft's status comes from two facts: whether it has a game, and whether the Maker is working", () => {
  assert.equal(draftStatus({ hasGame: false, working: true }), "making");
  assert.equal(draftStatus({ hasGame: false, working: false }), "unmade");
  assert.equal(draftStatus({ hasGame: true, working: true }), "updating");
  assert.equal(draftStatus({ hasGame: true, working: false }), "ready");
});

test("the list's facts: a titled Draft has a game, and a turn mark means the Maker is working", () => {
  assert.deepEqual(listedFacts(draft()), { hasGame: false, working: false });
  assert.deepEqual(listedFacts(draft(GAME)), { hasGame: true, working: false });
  assert.deepEqual(listedFacts(draft(TURN)), { hasGame: false, working: true });
  assert.equal(isWorking(draft(TURN)), true);
  // A Worker from before the turn mark sends no field.
  const { turnStartedAt: _, ...old } = draft(GAME);
  assert.deepEqual(listedFacts(old), { hasGame: true, working: false });
  assert.equal(draftCard(old, NOW).badge, "Ready to play · 2 h ago");
});

test("a card says the Draft's status with the turn's clock while the Maker works, else how long ago it changed", () => {
  assert.deepEqual(draftCard(draft(TURN), NOW), {
    badge: "Making · 3:12",
    hasGame: false,
    id: "d1",
    label: "New game. Making, 3:12",
    line: undefined,
    status: "making",
    title: "New game",
    working: true,
  });
  assert.deepEqual(draftCard(draft(), NOW), {
    badge: "No game yet · 2 h ago",
    hasGame: false,
    id: "d1",
    label: "New game. No game yet, 2 h ago",
    line: undefined,
    status: "unmade",
    title: "New game",
    working: false,
  });
  assert.deepEqual(draftCard(draft(GAME), NOW), {
    badge: "Ready to play · 2 h ago",
    hasGame: true,
    id: "d1",
    label: "Moon Cat. Ready to play, 2 h ago. A cat on the moon.",
    line: "A cat on the moon.",
    status: "ready",
    title: "Moon Cat",
    working: false,
  });
  const updating = draftCard(draft({ ...GAME, ...TURN }), NOW + 1000);
  assert.equal(updating.status, "updating");
  assert.equal(updating.badge, "Updating · 3:13");
});

// pi's frames as the Maker sends them (apps/worker/src/maker.ts), and the chat they make.
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
const result = (id, callId, toolName) => ({
  id,
  kind: "pi.tool-result",
  model: [{ content: [], role: "toolResult", toolCallId: callId, toolName }],
});
const said = (id, text) => ({
  id,
  kind: "pi.assistant",
  model: [{ content: [{ text, type: "text" }], role: "assistant" }],
});
const live = (data, now = NOW, ...actions) => {
  let chat = makerChat(NEW_CHAT, {
    frame: {
      data: { entries: [], inbox: [], type: "snapshot", ...data },
      type: "snapshot",
    },
    type: "frame",
  });
  for (const action of actions) {
    chat = makerChat(chat, action);
  }
  return chatView(chat, now);
};
const FIRST = Date.parse("2026-10-23T11:58:00.000Z");
const WRITING = [
  asked(1, "A cat on the moon", FIRST),
  call(2, "c1", "write", { path: "game.ts" }),
  result(3, "c1", "write"),
  call(4, "c2", "playtest", {}),
];
const BUILT = [
  ...WRITING,
  result(5, "c2", "playtest"),
  call(6, "c3", "build", GAME),
  result(7, "c3", "build"),
];

test("a page without its chat reads the list: the card's status, and its badge as the work line", () => {
  assert.deepEqual(draftPage(draft(TURN), undefined, NOW), {
    asked: undefined,
    canPublish: false,
    draft: draft(TURN),
    hasGame: false,
    status: "making",
    steps: [],
    work: "Making · 3:12",
    working: true,
  });
  const ready = draftPage(draft(GAME), undefined, NOW);
  assert.equal(ready.status, "ready");
  assert.equal(ready.work, undefined);
  assert.equal(ready.canPublish, true);
  const updating = draftPage(draft({ ...GAME, ...TURN }), undefined, NOW);
  assert.equal(updating.status, "updating");
  assert.equal(updating.work, "Updating · 3:12");
  assert.equal(updating.canPublish, false);
});

test("a page with its chat shows the turn as the chat does: what was asked, the steps so far and the work in flight", () => {
  const page = draftPage(draft(TURN), live({ entries: WRITING, run: {} }), NOW);
  assert.equal(page.status, "making");
  assert.equal(page.asked, "A cat on the moon");
  assert.deepEqual(page.steps, [{ key: "step-3", text: "Wrote the game" }]);
  assert.equal(page.work, "Testing · 2:00");
});

test("a page believes its chat over the list", () => {
  // The list still says a turn runs, and the chat knows it ended without a game.
  const failed = draftPage(
    draft(TURN),
    live({ entries: [asked(1, "A cat on the moon", FIRST)] }),
    NOW
  );
  assert.equal(failed.status, "unmade");
  assert.equal(failed.work, undefined);
  assert.deepEqual(failed.steps, []);
  assert.equal(failed.asked, "A cat on the moon");

  // The build's card lands mid-turn, before the list has a title: the page has a game to play, named by the card.
  const landed = draftPage(draft(TURN), live({ entries: BUILT, run: {} }), NOW);
  assert.equal(landed.status, "updating");
  assert.equal(landed.draft.title, "Moon Cat");
  assert.equal(landed.draft.description, "A cat on the moon.");
  assert.equal(landed.canPublish, false);

  // The turn over, it can be published even while the list is a poll behind.
  const done = draftPage(
    draft(TURN),
    live({ entries: [...BUILT, said(8, "Tap to jump!")] }),
    NOW
  );
  assert.equal(done.status, "ready");
  assert.equal(done.canPublish, true);
  assert.equal(done.work, undefined);
});

test("a change to a game shows only its own turn's steps, and a queued steer as what was asked", () => {
  const changing = live(
    {
      entries: [
        ...BUILT,
        said(8, "Tap to jump!"),
        asked(9, "Make it faster", FIRST),
        call(10, "c4", "edit", { path: "game.ts" }),
        result(11, "c4", "edit"),
        call(12, "c5", "playtest", {}),
      ],
      run: {},
    },
    NOW,
    { key: "0", text: "And orange", type: "send" }
  );
  assert.deepEqual(liveFacts(draft(), changing), {
    hasGame: true,
    working: true,
  });
  const page = draftPage(draft(GAME), changing, NOW);
  assert.equal(page.status, "updating");
  assert.deepEqual(page.steps, [{ key: "step-11", text: "Wrote the game" }]);
  assert.equal(page.asked, "And orange");
});

test("the chat opens the Draft asked for, else the newest; one that is gone opens a new chat and says so", () => {
  const drafts = [draft({ id: "new" }), draft({ id: "old" })];
  assert.deepEqual(draftToOpen(drafts), {
    draft: drafts[0],
    gone: false,
  });
  assert.deepEqual(draftToOpen(drafts, "old"), {
    draft: drafts[1],
    gone: false,
  });
  assert.deepEqual(draftToOpen(drafts, "published"), {
    draft: null,
    gone: true,
  });
  assert.deepEqual(draftToOpen([]), { draft: null, gone: false });
});

test("the list is full at the most Drafts a Creator can keep", () => {
  const drafts = Array.from({ length: MAX_DRAFTS }, () => draft());
  assert.equal(isFull(drafts), true);
  assert.equal(isFull(drafts.slice(1)), false);
});
