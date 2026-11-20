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
  // The turn passes only if one of its builds published a Revision.
  publishes?: boolean;
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
// How the Maker works, which the Creator must never hear about. Plain "test", "build", "check" and "tool" are game
// words too ("test your reflexes", "build a tower", "collect tools"), so those match only in a phrase about the work.
const PROCESS =
  /\b(?:advis[eo]r|playtest\w*|untested|(?:the|my|all|every) tests?\b|tests? (?:pass|fail|ran|run)\w*|tests\.json|verif(?:y|ied|ies|ying|ication)|typecheck\w*|harness|screenshots?|tool calls?|(?:build|bash|edit) tool|the build (?:pass|fail|succeed)\w*|(?:final|done) check|design\.md|workspace)\b/giu;

// The words in a reply that talk about the Maker's process instead of the game.
export const processTalk = (reply: string) =>
  [...reply.matchAll(PROCESS)].map((match) => match[0].toLowerCase());

// A limit reaching the Creator (ADR 0009): the harness's words for one, or the give-up the 5-minute deadline produced.
// "Time limit", "ceiling" and "too hard" are game words, so none counts alone.
const LIMIT =
  /\b(?:(?:step|build|tool[- ]call) limits?|minute ceiling|deadline|ran out of time|out of time|time ran out|took too long|(?:say|ask|try) it (?:more )?simpl[ey]\w*|(?:something|maybe|a bit|little) simpler|couldn't make it work)\b/giu;

export const limitTalk = (reply: string) =>
  [...reply.matchAll(LIMIT)].map((match) => match[0].toLowerCase());

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
  published,
  status,
  unanswered,
}: {
  turn: ChatTurn;
  reply: string;
  builds: Spec[];
  cost: number;
  ms: number;
  buildMs: number;
  // How many of the turn's builds published a Revision.
  published: number;
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
  limitTalk: limitTalk(reply),
  mentionOk: turn.briefMentions
    ? builds.some((spec) =>
        `${spec.title} ${spec.brief}`
          .toLowerCase()
          .includes(turn.briefMentions ?? "")
      )
    : true,
  processTalk: processTalk(reply),
  publishOk: !turn.publishes || published > 0,
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
      turn.mentionOk &&
      turn.publishOk
  );
  const processOk = turns.every((turn) => turn.processTalk.length === 0);
  const limitOk = turns.every((turn) => turn.limitTalk.length === 0);
  const scoresOk = scoresPass(agents, judged, turns);
  const record = {
    agent: "talker",
    agents,
    behaviourOk,
    brevityOk,
    chat: chat.id,
    cost: turns.reduce((sum, turn) => sum + turn.cost, 0),
    judge: scores,
    limitOk,
    model: modelId,
    pass: brevityOk && behaviourOk && processOk && limitOk && scoresOk,
    processOk,
    run,
    thinking,
    turns,
  };
  writeFileSync(path.join(dir, "result.json"), JSON.stringify(record, null, 2));
  return record;
};

export type TalkerRecord = Awaited<ReturnType<typeof judgeChat>>;
