// The eval's scripted chats (#115) and how a chat is judged: what the Creator says each turn, what the Maker replies
// and builds, and the judge's scores. The e2e run (preview.ts) plays them on a Preview.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Spec } from "../src/job.ts";
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

const MAX_WORDS = 60;
const CODE = /```|<\/?[a-z][\w-]*[\s>]|\bfunction\b|=>|\bconst \w+ =|;\s*$/mu;

// One turn as the report reads it, from the Draft's socket (preview.ts).
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

// Whether the judge's scores pass a chat: every turn understood, and with two agents every build's brief a good spec.
// With one agent (ADR 0006) a build has no brief, and the "spec" item grades the Creator's own words, so it is recorded
// but not part of a pass.
export const scoresPass = (
  agents: 1 | 2,
  judged:
    | readonly {
        understood: { score: number };
        spec: { score: number } | null;
      }[]
    | undefined,
  turns: readonly { builds: readonly unknown[] }[]
) =>
  judged !== undefined &&
  judged.length === turns.length &&
  judged.every(
    (turn, index) =>
      turn.understood.score >= 4 &&
      (agents === 1 ||
        turns[index]?.builds.length === 0 ||
        (turn.spec?.score ?? 0) >= 4)
  );

// The chat judged and scored, into result.json.
export const judgeChat = async ({
  agents,
  chat,
  dir,
  modelId,
  run,
  thinking,
  turns,
}: {
  agents: 1 | 2;
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
  const scoresOk = scoresPass(agents, judged, turns);
  const record = {
    agent: "talker",
    agents,
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

export type TalkerRecord = Awaited<ReturnType<typeof judgeChat>>;
