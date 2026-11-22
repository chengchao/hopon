// `ask_advisor` (P2 of docs/plans/maker-single-agent-vite.md): the Maker's agent asks a stronger model, Opus 5.5 or
// Fable 5.2 (MAKER_ADVISOR_MODEL), for advice. The advisor gets the conversation as text and the question, with no tools
// and no sandbox, so it only advises; its answer is the tool's result, and its cost is the Creator's like any call.
import { Type } from "@earendil-works/pi-ai";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import type { Models } from "@earendil-works/pi-ai/models";
import { defineTool } from "@earendil-works/pi-durable";
import type { Harness } from "@earendil-works/pi-durable";

import ADVISOR from "../prompts/advisor.md";
import { chargeCall } from "./pi-models.ts";
import { toolResult } from "./tool-results.ts";

export const ADVISOR_PROVIDER = "advisor";

// A tool's output past this is cut: skills and logs the advisor needs only the start of. The agent's own words and its
// tool calls, the code it wrote included, are sent whole.
const RESULT_CHARS = 4000;
// The design the game is checked against (designer.ts), which is in no tool call of the agent's: sent whole.
const WHOLE = new Set(["design_game"]);

const SKILL_TEXT = new Set(["activate_skill", "read_skill_resource"]);

const clip = (text: string) =>
  text.length > RESULT_CHARS
    ? `${text.slice(0, RESULT_CHARS)}\n[${text.length - RESULT_CHARS} more characters cut]`
    : text;

export const texts = (content: Message["content"]) =>
  typeof content === "string"
    ? content
    : content
        .map((block) => {
          if (block.type === "text") {
            return block.text;
          }
          if (block.type === "toolCall") {
            return `[calls ${block.name} ${JSON.stringify(block.arguments)}]`;
          }
          return block.type === "image" ? "[image]" : "";
        })
        .filter(Boolean)
        .join("\n");

// The model context as one text: the advisor's request carries no tool calls, so it needs no tools.
const render = (messages: readonly Message[]) =>
  messages
    .flatMap((message) => {
      switch (message.role) {
        case "user": {
          return [`USER:\n${texts(message.content)}`];
        }
        case "assistant": {
          return [`MAKER:\n${texts(message.content)}`];
        }
        case "toolResult": {
          // pi stands in an error result for a call still running, this ask_advisor call's own.
          if (
            (message.details as { reason?: string } | undefined)?.reason ===
            "missing_result"
          ) {
            return [];
          }
          // The skill and its references: the Maker's reading, of which a cut-off start tells the advisor nothing.
          if (SKILL_TEXT.has(message.toolName)) {
            return [];
          }
          const status = message.isError ? " (error)" : "";
          const said = texts(message.content);
          return [
            `RESULT of ${message.toolName}${status}:\n${WHOLE.has(message.toolName) ? said : clip(said)}`,
          ];
        }
        default: {
          return [];
        }
      }
    })
    .join("\n\n");

export const text = (said: string) => [{ text: said, type: "text" as const }];

// The agent gets no advice, and why, and goes on to build: a run the Creator pays for still ends in a Revision.
const noAdvice = (why: string) => ({
  isError: true,
  output: text(toolResult("no-advice", { WHY: why.replace(/\.$/u, "") })),
});

// The model sees this with the tool every turn, the make-game skill loaded or not.
const DESCRIPTION = `Ask a stronger model for advice. It sees this whole conversation, your tool calls and their results included, plus your question. It only advises: it can't read or change files, run anything, or see screenshots. Ask it:
- Before every build, as the done check: once the playtest, verify and your tests pass, ask what the game misses of what the Creator asked and what is obviously broken.
- Before a hard design choice you can't settle.
- When you're stuck after two failed fixes of the same bug: give the errors and what each fix tried.
- Before a large structural change, such as multiplayer, saves or levels.
Don't paste code it can already see.`;

// One call to the stronger model, with no tools and no cache, charged to the Creator: what it said, or why it said
// nothing.
export const consult = async (
  env: Env,
  draftId: string,
  models: Models,
  request: {
    content: string;
    now: number;
    signal?: AbortSignal;
    systemPrompt: string;
  }
): Promise<
  | { said: string; usage: AssistantMessage["usage"] }
  | { why: string; usage?: AssistantMessage["usage"] }
> => {
  const model = models.getModel(ADVISOR_PROVIDER, env.MAKER_ADVISOR_MODEL);
  if (!model) {
    console.error(
      `Draft ${draftId}: no advisor model ${env.MAKER_ADVISOR_MODEL}`
    );
    return { why: `is unavailable: no model ${env.MAKER_ADVISOR_MODEL}` };
  }
  const answer = await models.completeSimple(
    model,
    {
      messages: [
        { content: request.content, role: "user", timestamp: request.now },
      ],
      systemPrompt: request.systemPrompt,
    },
    // One call with nothing after it to read a cache, so writing one only costs more.
    { cacheRetention: "none", reasoning: "medium", signal: request.signal }
  );
  await chargeCall(env, draftId, answer.usage.cost.total);
  const { usage } = answer;
  // A refusal is pi's "error"; one cut at max tokens can come back with thinking and no text.
  if (answer.stopReason === "error" || answer.stopReason === "aborted") {
    return {
      usage,
      why: `couldn't answer: ${answer.errorMessage ?? answer.stopReason}`,
    };
  }
  const said = texts(answer.content).trim();
  return said
    ? { said, usage }
    : { usage, why: `gave no answer: it stopped on ${answer.stopReason}` };
};

// Why the Creator's Allowance stops a call to the stronger model.
export const NO_ALLOWANCE =
  "wasn't asked: the Creator's Allowance has none left for it";

export const askAdvisor = (
  env: Env,
  draftId: () => string,
  // Whether the Creator's Allowance has any left.
  allowed: () => Promise<boolean>,
  // The opened pi, whose conversation holds the context the agent's next call would send.
  pi: () => Promise<Harness>
) =>
  defineTool({
    description: DESCRIPTION,
    execute: async ({ question }, api, call) => {
      // ADR 0004 lets started work finish, so a run that crossed zero skips the advice, not the build.
      if (!(await allowed())) {
        return noAdvice(NO_ALLOWANCE);
      }
      const opened = await pi();
      const conversation = await opened.conversation(api.conversationId, call);
      const { messages } = (await conversation?.context(call)) ?? {
        messages: [],
      };
      const answer = await consult(env, draftId(), api.models, {
        content: `<conversation>\n${render(messages)}\n</conversation>\n\nThe Maker's question:\n${question}`,
        now: api.now(),
        signal: call?.abortSignal,
        systemPrompt: ADVISOR,
      });
      return "said" in answer
        ? { output: text(answer.said), usage: answer.usage }
        : { ...noAdvice(answer.why), usage: answer.usage };
    },
    name: "ask_advisor",
    parameters: Type.Object({
      question: Type.String({
        description:
          "What you need advice on, with the errors and what you tried when you're stuck",
      }),
    }),
  });
