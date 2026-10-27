// One Talker chat of the eval: scripted Creator turns against a stub Coder that returns canned results (#115).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import type { Thinking } from "../src/coder.ts";
import type { Spec } from "../src/job.ts";
import { openTalker } from "../src/talker.ts";
import type { BuildResult, Talker } from "../src/talker.ts";
import { judgeTalker } from "./judge.ts";
import type { TalkerTurnRecord } from "./judge.ts";

interface ChatTurn {
  text: string;
  builds: number;
  steer?: string;
  briefMentions?: string;
}
export interface Chat {
  id: string;
  behaviour: string;
  turns: ChatTurn[];
}
export const CHATS = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "chats.json"), "utf-8")
) as Chat[];

// Long enough for a steer to land mid-build; it is subtracted from the reply time.
const STUB_BUILD_MS = 3000;
const STEER_AFTER_MS = 1000;
const MAX_WORDS = 60;
const CODE = /```|<\/?[a-z][\w-]*[\s>]|\bfunction\b|=>|\bconst \w+ =|;\s*$/mu;

const totalCost = (usage: {
  models: Record<string, { cost: { total: number } }>;
}) =>
  Object.values(usage.models).reduce((sum, model) => sum + model.cost.total, 0);

// The stub Coder's state for the current turn.
interface Stub {
  builds: Spec[];
  buildMs: number;
  steer?: () => void;
}

// One turn as the report reads it. The end-to-end run against a Preview (preview.ts) makes the same record from the
// Draft's socket.
export const turnRecord = ({
  turn,
  reply,
  builds,
  cost,
  ms,
  buildMs,
  firstTokenMs,
  firstVisibleMs,
  status,
  unanswered,
}: {
  turn: ChatTurn;
  reply: string;
  builds: Spec[];
  cost: number;
  ms: number;
  buildMs: number;
  firstTokenMs: number | undefined;
  firstVisibleMs: number | undefined;
  status: string;
  // Why an input went unanswered (a model error, a refused request), for the report and the billing stop.
  unanswered: string | undefined;
}) => ({
  builds,
  buildsExpected: turn.builds,
  codeShown: CODE.test(reply),
  cost,
  creator: turn.text,
  firstTokenMs,
  firstVisibleMs,
  mentionOk: turn.briefMentions
    ? builds.some((spec) =>
        `${spec.title} ${spec.brief}`
          .toLowerCase()
          .includes(turn.briefMentions ?? "")
      )
    : true,
  reply,
  replyMs: ms - buildMs,
  status,
  steer: turn.steer,
  unanswered,
  words: reply.split(/\s+/u).filter(Boolean).length,
});
type TurnRecord = ReturnType<typeof turnRecord>;

const playTurn = async (talker: Talker, stub: Stub, turn: ChatTurn) => {
  stub.builds = [];
  stub.buildMs = 0;
  stub.steer = turn.steer
    ? () => {
        void talker.steer(turn.steer ?? "");
        stub.steer = undefined;
      }
    : undefined;
  // The reply is every assistant message of the turn, read from its committed entry: partials arrive as deltas or
  // as whole blocks, depending on commit timing. First token: the first streamed change of any kind (thinking too);
  // first visible: the first text or tool call, what the app can show.
  const texts: string[] = [];
  let firstToken: number | undefined;
  let firstVisible: number | undefined;
  const unlisten = talker.listen((event) => {
    if (event.type === "message_update") {
      firstToken ??= Date.now();
      const visible = event.changes.some(
        (change) =>
          change.type === "text_delta" ||
          change.type === "toolcall_start" ||
          ((change.type === "block" || change.type === "text_start") &&
            change.block.type !== "thinking")
      );
      if (visible) {
        firstVisible ??= Date.now();
      }
    } else if (
      event.type === "message_end" &&
      event.entry.kind === "pi.assistant"
    ) {
      const [message] = event.entry.model ?? [];
      if (message?.role === "assistant") {
        firstToken ??= Date.now();
        firstVisible ??= Date.now();
        texts.push(
          message.content
            .flatMap((part) => (part.type === "text" ? [part.text] : []))
            .join("")
        );
      }
    }
  });
  const costBefore = totalCost(await talker.usage());
  const started = Date.now();
  const settled = await talker.turn(turn.text);
  const ms = Date.now() - started;
  unlisten();
  const reply = texts.join("\n").trim();
  return turnRecord({
    buildMs: stub.buildMs,
    builds: stub.builds,
    cost: totalCost(await talker.usage()) - costBefore,
    firstTokenMs: firstToken === undefined ? undefined : firstToken - started,
    firstVisibleMs:
      firstVisible === undefined ? undefined : firstVisible - started,
    ms,
    reply,
    status: settled.status,
    turn,
    unanswered:
      settled.status === "done"
        ? undefined
        : JSON.stringify(settled).slice(0, 500),
  });
};

// The chat judged and scored, into result.json.
export const judgeChat = async ({
  chat,
  dir,
  modelId,
  run,
  thinking,
  turns,
}: {
  chat: Chat;
  dir: string;
  modelId: string;
  run: number;
  thinking: string;
  turns: TurnRecord[];
}) => {
  const scores = await judgeTalker(
    chat.behaviour,
    turns.map((turn): TalkerTurnRecord => ({
      builds: turn.builds,
      creator: turn.creator,
      reply: turn.reply,
      steer: turn.steer,
    }))
  ).catch((error: unknown) => ({ error: String(error) }));
  const judged = "error" in scores ? undefined : scores.turns;
  const brevityOk = turns.every(
    (turn) => turn.words <= MAX_WORDS && !turn.codeShown
  );
  const behaviourOk = turns.every(
    (turn) =>
      turn.status === "done" &&
      turn.builds.length === turn.buildsExpected &&
      turn.mentionOk
  );
  const scoresOk =
    judged !== undefined &&
    judged.length === turns.length &&
    judged.every(
      (turn, index) =>
        turn.understood.score >= 4 &&
        (turns[index]?.builds.length === 0 || (turn.spec?.score ?? 0) >= 4)
    );
  const record = {
    agent: "talker",
    behaviourOk,
    brevityOk,
    chat: chat.id,
    cost: turns.reduce((sum, turn) => sum + turn.cost, 0),
    judge: scores,
    model: modelId,
    pass: brevityOk && behaviourOk && scoresOk,
    run,
    thinking,
    turns,
  };
  writeFileSync(path.join(dir, "result.json"), JSON.stringify(record, null, 2));
  return record;
};

export const runTalker = async ({
  modelId,
  chat,
  run,
  dir,
  coder,
  thinking = "high",
}: {
  modelId: string;
  chat: Chat;
  run: number;
  dir: string;
  // The real Coder, for the end-to-end run; without it, a stub returns a canned success after 3 s.
  coder?: (spec: Spec) => Promise<BuildResult>;
  thinking?: Thinking;
}) => {
  mkdirSync(dir, { recursive: true });
  const stub: Stub = { buildMs: 0, builds: [] };
  const talker = await openTalker({
    build: async (spec) => {
      stub.builds.push(spec);
      const started = Date.now();
      setTimeout(() => stub.steer?.(), STEER_AFTER_MS);
      const result = coder
        ? await coder(spec)
        : await sleep(STUB_BUILD_MS).then((): BuildResult => ({
            ok: true,
            summary: `Built "${spec.title}". ${spec.brief.split(/(?<=\.)\s/u)[0]} It plays well and the playtest is green.`,
          }));
      stub.buildMs += Date.now() - started;
      return result;
    },
    modelId,
    thinking,
  });
  const turns: TurnRecord[] = [];
  try {
    for (const turn of chat.turns) {
      // oxlint-disable-next-line no-await-in-loop -- a chat's turns are sequential
      turns.push(await playTurn(talker, stub, turn));
    }
  } finally {
    await talker.close();
  }
  return await judgeChat({ chat, dir, modelId, run, thinking, turns });
};

export type TalkerRecord = Awaited<ReturnType<typeof judgeChat>>;
