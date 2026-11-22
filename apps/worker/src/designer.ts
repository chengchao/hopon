// `design_game`: the Maker's agent has a stronger model (MAKER_ADVISOR_MODEL, the advisor's) design a new game that
// needs a designer: an imitation of a game the Creator names, a kind of game, or a big one. The designer gets only what
// the Creator asked and designs for the play; its answer is the game's design.md, written to the workspace before any
// code, and the tool's result, so the agent builds from it and never writes the design a second time. Only an
// imitation's designer gets make-game's imitation reference, as only an imitation's agent reads it.
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";

import DESIGN from "../../maker/agent-home/.agents/skills/make-game/references/design.md";
import IMITATION from "../../maker/agent-home/.agents/skills/make-game/references/imitation.md";
import type { Box } from "../../maker/src/job.ts";
import DESIGNER from "../prompts/designer.md";
import { NO_ALLOWANCE, consult, text } from "./advisor.ts";
import { renderPrompt } from "./prompts.ts";
import { toolResult } from "./tool-results.ts";

const WORKSPACE = "/workspace";
// The copy the new-game command keeps: it deletes design.md with the old game, and starter.js puts this one back.
export const KEPT_DESIGN = `${WORKSPACE}/.hopon/design.md`;

// The designer writes the parts the agent would: make-game's own list, so the two can't drift apart.
const parts = /\n## The parts\n\n[^\n]+\n\n(?<list>[\s\S]+?)\n\n## /u.exec(
  DESIGN
)?.groups?.list;
if (!parts) {
  throw new Error("references/design.md has no list under ## The parts");
}
export const DESIGNER_PROMPT = renderPrompt(DESIGNER, { PARTS: parts });

const noDesign = (why: string) => ({
  isError: true,
  output: text(toolResult("no-design", { WHY: why })),
});

// The model sees this with the tool every turn, the make-game skill loaded or not.
const DESCRIPTION = `Have a game designer design a new game and write its design.md. Call it once, before any other work on a new game, when the Creator names an existing game to imitate ("like Zelda", "a Tetris clone"), asks for a kind of game ("a roguelike", "a farming game"), or asks for a big game. The designer sees everything the Creator asked. Its design comes back as the result and is already saved as design.md: build the game from it, and don't write design.md again. Never call it for a small game or for a change to a game: write or edit design.md yourself.`;

export const designGame = (
  env: Env,
  draftId: () => string,
  // Whether the Creator's Allowance has any left.
  allowed: () => Promise<boolean>,
  // What the Creator has asked since their last new game.
  asked: () => readonly string[],
  box: (signal?: AbortSignal) => Box
) =>
  defineTool({
    description: DESCRIPTION,
    execute: async ({ imitates }, api, call) => {
      if (!(await allowed())) {
        return noDesign(NO_ALLOWANCE);
      }
      const answer = await consult(env, draftId(), api.models, {
        content: `What the Creator has asked for, one message after another:\n\n${asked()
          .map((message) => `<message>\n${message}\n</message>`)
          .join(
            "\n"
          )}${imitates ? `\n\nThe game to imitate: ${imitates}` : ""}`,
        now: api.now(),
        signal: call?.abortSignal,
        systemPrompt: imitates
          ? `${DESIGNER_PROMPT}\n\n${IMITATION}`
          : DESIGNER_PROMPT,
      });
      if (!("said" in answer)) {
        return { ...noDesign(answer.why), usage: answer.usage };
      }
      const workspace = box(call?.abortSignal);
      await workspace.write(KEPT_DESIGN, answer.said);
      await workspace.write(`${WORKSPACE}/design.md`, answer.said);
      return {
        output: text(`${toolResult("designed")}\n\n${answer.said}`),
        usage: answer.usage,
      };
    },
    executionMode: "sequential",
    name: "design_game",
    parameters: Type.Object({
      imitates: Type.Optional(
        Type.String({
          description:
            "The existing game the Creator names to imitate or remake, by its name. Leave it out when they name none.",
        })
      ),
    }),
  });
