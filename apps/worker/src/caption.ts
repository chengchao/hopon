// A Caption for the publish sheet: the one line the Creator says under their game in the feed, written when they
// tap "Write it for me" or "Write another". Haiku 5.5 writes it in one call with no tools, through the Maker's model path
// (pi-models.ts), so the call is logged, tagged with its Draft, and charged to the Creator's Allowance like the
// Maker's. The Draft's Maker runs it for the API.
import { characters, GAME_DESCRIPTION_MAX } from "@hopon/schemas";

import CAPTION from "../prompts/caption.md";
import { texts } from "./advisor.ts";
import { chargeCall, piModels } from "./pi-models.ts";
import { renderPrompt } from "./prompts.ts";

const MODEL = "claude-haiku-5-5";
const PROVIDER = "caption";
// A Caption is a few dozen tokens; this stops a model that ignores the prompt before it costs much.
const MAX_TOKENS = 200;

export const CAPTION_PROMPT = renderPrompt(CAPTION, {
  CAPTION_MAX: GAME_DESCRIPTION_MAX,
});

const QUOTED = /^["'“‘「『](?<caption>.*)["'”’」』]$/u;

// The model's answer as the games table takes it: its first line, without quotes around it, cut to the limit.
export const oneLine = (said: string) => {
  const first =
    said
      .replaceAll("\0", "")
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  const caption = QUOTED.exec(first)?.groups?.caption.trim() ?? first;
  return characters(caption) > GAME_DESCRIPTION_MAX
    ? [...caption].slice(0, GAME_DESCRIPTION_MAX).join("").trim()
    : caption;
};

const tagged = (tag: string, value: string) => `<${tag}>\n${value}\n</${tag}>`;

// The Draft's game: its title, the Maker's description of it, and the Caption the Creator is looking at, empty when
// there is none.
export interface Game {
  title: string;
  description: string;
  current: string;
}

// A Caption for the Draft's game, or undefined when the model gave none.
export const writeCaption = async (env: Env, draftId: string, game: Game) => {
  const models = piModels(env, [
    {
      metadata: () => ({ agent: "caption", draftId }),
      model: MODEL,
      provider: PROVIDER,
    },
  ]);
  const model = models.getModel(PROVIDER, MODEL);
  if (!model) {
    return;
  }
  const answer = await models.completeSimple(
    model,
    {
      messages: [
        {
          content: [
            tagged("title", game.title),
            tagged("game", game.description),
            ...(game.current ? [tagged("current-caption", game.current)] : []),
          ].join("\n\n"),
          role: "user",
          timestamp: Date.now(),
        },
      ],
      systemPrompt: CAPTION_PROMPT,
    },
    // One call with nothing after it to read a cache, so writing one only costs more.
    { cacheRetention: "none", maxTokens: MAX_TOKENS }
  );
  await chargeCall(env, draftId, answer.usage.cost.total);
  if (answer.stopReason === "error" || answer.stopReason === "aborted") {
    console.error(
      `Draft ${draftId}: no caption: ${answer.errorMessage ?? answer.stopReason}`
    );
    return;
  }
  return oneLine(texts(answer.content)) || undefined;
};
