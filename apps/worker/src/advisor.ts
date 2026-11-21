// `ask_advisor` (P2 of docs/plans/maker-single-agent-vite.md): the Maker's agent asks a stronger model, Opus 5.5 or
// Fable 5.2 (MAKER_ADVISOR_MODEL), for advice. The advisor gets the conversation as text and the question, with no tools
// and no sandbox, so it only advises; its answer is the tool's result, and its cost is the Creator's like any call.
import { Type } from "@earendil-works/pi-ai";
import type { Message } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import type { Harness } from "@earendil-works/pi-durable";

import ADVISOR from "../prompts/advisor.md";
import { chargeCall } from "./pi-models.ts";
import { toolResult } from "./tool-results.ts";

export const ADVISOR_PROVIDER = "advisor";

// A tool's output past this is cut: skills and logs the advisor needs only the start of. The agent's own words and its
// tool calls, the code it wrote included, are sent whole.
const RESULT_CHARS = 4000;

const clip = (text: string) =>
  text.length > RESULT_CHARS
    ? `${text.slice(0, RESULT_CHARS)}\n[${text.length - RESULT_CHARS} more characters cut]`
    : text;

const texts = (content: Message["content"]) =>
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
          const status = message.isError ? " (error)" : "";
          return [
            `RESULT of ${message.toolName}${status}:\n${clip(texts(message.content))}`,
          ];
        }
        default: {
          return [];
        }
      }
    })
    .join("\n\n");

const text = (said: string) => [{ text: said, type: "text" as const }];

// The agent gets no advice, and why, and goes on to build: a run the Creator pays for still ends in a Revision.
const noAdvice = (why: string) => ({
  isError: true,
  output: text(toolResult("no-advice", { WHY: why.replace(/\.$/u, "") })),
});

// The model sees this with the tool every turn, the make-game skill loaded or not.
const DESCRIPTION = `Ask a stronger model for advice. It sees this whole conversation, your tool calls and their results included, plus your question. It only advises: it can't read or change files, run anything, or see screenshots. Ask it:
- Before you write design.md for a new game, when the Creator names a game or a kind of game or asks for a big one, as the design brief: ask it to design the game, and write design.md from its brief.
- Before every build, as the done check: once the playtest, verify and your tests pass, ask what the game misses of what the Creator asked and what is obviously broken.
- Before a hard design choice you can't settle.
- When you're stuck after two failed fixes of the same bug: give the errors and what each fix tried.
- Before a large structural change, such as multiplayer, saves or levels.
Don't paste code it can already see.`;

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
        return noAdvice(
          "wasn't asked: the Creator's Allowance has none left for it"
        );
      }
      const model = api.models.getModel(
        ADVISOR_PROVIDER,
        env.MAKER_ADVISOR_MODEL
      );
      if (!model) {
        console.error(
          `Draft ${draftId()}: no advisor model ${env.MAKER_ADVISOR_MODEL}`
        );
        return noAdvice(`is unavailable: no model ${env.MAKER_ADVISOR_MODEL}`);
      }
      const opened = await pi();
      const conversation = await opened.conversation(api.conversationId, call);
      const { messages } = (await conversation?.context(call)) ?? {
        messages: [],
      };
      const answer = await api.models.completeSimple(
        model,
        {
          messages: [
            {
              content: `<conversation>\n${render(messages)}\n</conversation>\n\nThe Maker's question:\n${question}`,
              role: "user",
              timestamp: api.now(),
            },
          ],
          systemPrompt: ADVISOR,
        },
        // One call with nothing after it to read a cache, so writing one only costs more.
        {
          cacheRetention: "none",
          maxTokens: 16_000,
          reasoning: "medium",
          signal: call?.abortSignal,
        }
      );
      await chargeCall(env, draftId(), answer.usage.cost.total);
      // A refusal is pi's "error"; one cut at max tokens can come back with thinking and no text.
      const advice = texts(answer.content).trim();
      if (answer.stopReason === "error" || answer.stopReason === "aborted") {
        return {
          ...noAdvice(
            `couldn't answer: ${answer.errorMessage ?? answer.stopReason}`
          ),
          usage: answer.usage,
        };
      }
      if (!advice) {
        return {
          ...noAdvice(`gave no advice: it stopped on ${answer.stopReason}`),
          usage: answer.usage,
        };
      }
      return { output: text(advice), usage: answer.usage };
    },
    name: "ask_advisor",
    parameters: Type.Object({
      question: Type.String({
        description:
          "What you need advice on, with the errors and what you tried when you're stuck",
      }),
    }),
  });
