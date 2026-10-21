// The eval's judge (#115): Opus 5.5 through the gateway at default thinking (adaptive, effort high: pi sends
// "disabled" without a level, which Opus 5.5 rejects), scoring 1–5 with a one-line reason each.
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";

import type { PlaytestResult, Spec } from "../src/coder.ts";
import { createRegistry, JUDGE } from "../src/models.ts";

const models = createRegistry();

export interface Score {
  score: number;
  reason: string;
}

const SCALE = `Score each item 1–5: 5 = fully, 4 = yes with small flaws, 3 = partly, 2 = barely, 1 = not at all. Answer with only a JSON object, no prose around it.`;

const ask = async (system: string, content: (TextContent | ImageContent)[]) => {
  const message = await models.completeSimple(
    JUDGE(),
    {
      messages: [{ content, role: "user", timestamp: Date.now() }],
      systemPrompt: system,
    },
    { reasoning: "high" }
  );
  if (message.stopReason === "error") {
    throw new Error(message.errorMessage ?? "judge request failed");
  }
  const text = message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return {
    cost: message.usage.cost.total,
    scores: JSON.parse(json) as Record<string, unknown>,
  };
};

const CODER_SYSTEM = `You grade small phone games built by an AI from a build spec. You get the spec, the game's source, screenshots of the start and the end of a scripted playtest (360×640, the start one is taken just after a tap that starts the game), and the playtest's signals.

Items:
- "spec": does the game read as the spec? Goal, rules, controls, look.
- "playable": is it playable on a phone? A clear goal, the controls work by tap or swipe, it doesn't end before the player can act, and everything is visible and readable.
- "edit" (only when an original game is given): did the change do what was asked, and break nothing else?
- "looks": does it look polished, like a finished casual game rather than a prototype? Judge the screenshots: a chosen palette, depth (gradients, shading, outlines, shadows), characters and objects with some detail, a background that isn't one flat fill, readable type. 1 = flat placeholder shapes on a plain fill, 3 = tidy but plain, 5 = could ship in a store.

${SCALE} Shape: {"spec": {"score": n, "reason": "one line"}, "playable": {...}, "edit": {...} or null, "looks": {...}}`;

const source = (label: string, set: Record<string, string>) =>
  Object.entries(set)
    .filter(([file]) => file === "game.ts" || file === "index.html")
    .map(([file, text]) => `${label} ${file}:\n${text}`)
    .join("\n\n");

export const judgeCoder = async ({
  spec,
  original,
  files,
  start,
  end,
  signals,
}: {
  spec: Spec;
  original?: Record<string, string>;
  files: Record<string, string>;
  start?: string;
  end?: string;
  signals: PlaytestResult;
}) => {
  const images: ImageContent[] = [start, end].flatMap((data) =>
    data ? [{ data, mimeType: "image/png", type: "image" as const }] : []
  );
  const { cost, scores } = await ask(CODER_SYSTEM, [
    {
      text: [
        `Spec:\n${JSON.stringify(spec, null, 2)}`,
        original ? source("Original", original) : "",
        source("Built", files),
        `Playtest signals: ${JSON.stringify(signals)}`,
        "Screenshots: start, then end.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      type: "text",
    },
    ...images,
  ]);
  return {
    cost,
    edit: (original ? scores.edit : undefined) as Score | undefined,
    // Reported only, not part of a pass (#116's follow-up on polish).
    looks: scores.looks as Score | undefined,
    playable: scores.playable as Score,
    spec: scores.spec as Score,
  };
};

const TALKER_SYSTEM = `You grade the Talker of a game-making chat app. A Creator chats with the Talker; the Talker replies briefly and, when a game should be built or changed, sends one build spec ({title, brief, music}) to a coder who never sees the chat. Vague requests should be guessed and built, not answered with questions. Real people, web photos, hateful or sexual content must be declined without a build. Replies must be in the Creator's language. The Talker can make one build per Creator message. A message sent while a build runs reaches it only after that build, when no second build is possible, so the right answer is to say the change comes next and offer to make it; that is not a false excuse.

For every Creator turn, score:
- "understood": did the reply and the action (build or not) understand what the Creator wanted?
- "spec": only for turns with a build: is the build spec complete (goal, rules, controls, look for a new game; exactly the change plus "keep everything else" for a change) and faithful to the chat? null when there was no build.

${SCALE} Shape: {"turns": [{"understood": {"score": n, "reason": "one line"}, "spec": {...} or null}, ...]} with one entry per Creator turn, in order.`;

export interface TalkerTurnRecord {
  creator: string;
  steer?: string;
  reply: string;
  builds: Spec[];
}

export const judgeTalker = async (
  behaviour: string,
  turns: TalkerTurnRecord[]
) => {
  const { cost, scores } = await ask(TALKER_SYSTEM, [
    {
      text: `What this chat tests: ${behaviour}\n\n${turns
        .map(
          (turn, index) =>
            `Turn ${index + 1}\nCreator: ${turn.creator}${turn.steer ? `\nCreator (sent while the build ran): ${turn.steer}` : ""}\nBuilds: ${turn.builds.length > 0 ? JSON.stringify(turn.builds) : "none"}\nTalker: ${turn.reply}`
        )
        .join("\n\n")}`,
      type: "text",
    },
  ]);
  return {
    cost,
    turns: scores.turns as { understood: Score; spec: Score | null }[],
  };
};
