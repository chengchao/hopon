// `ask_advisor` (P2 of docs/plans/maker-single-agent-vite.md): the Maker's agent asks a stronger model, Opus 5.5 or
// Fable 5.2 (MAKER_ADVISOR_MODEL), for advice. The advisor gets the conversation as text and the question, with no tools
// and no sandbox, so it only advises; its answer is the tool's result, and its cost is the Creator's like any call.
import { Type } from "@earendil-works/pi-ai";
import type { Message } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import type { Harness } from "@earendil-works/pi-durable";

import ADVISOR from "../prompts/advisor.md";
import { chargeCall } from "./pi-models.ts";
import { USED_UP } from "./prompts.ts";
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

export const askAdvisor = (
  env: Env,
  draftId: () => string,
  // Whether the Creator's Allowance has any left.
  allowed: () => Promise<boolean>,
  // The opened pi, whose conversation holds the context the agent's next call would send.
  pi: () => Promise<Harness>
) =>
  defineTool({
    description:
      "Ask a stronger model for advice. It sees this whole conversation, your tool calls and their results included, plus your question, and answers with advice only: it can't read or change files or run anything. Say what you need decided, the errors and what you tried; don't paste code it can already see.",
    execute: async ({ question }, api, call) => {
      if (!(await allowed())) {
        return { output: text(toolResult("used-up", { USED_UP })) };
      }
      const model = api.models.getModel(
        ADVISOR_PROVIDER,
        env.MAKER_ADVISOR_MODEL
      );
      if (!model) {
        throw new Error(`no advisor model ${env.MAKER_ADVISOR_MODEL}`);
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
        { maxTokens: 16_000, reasoning: "medium", signal: call?.abortSignal }
      );
      await chargeCall(env, draftId(), answer.usage.cost.total);
      if (answer.stopReason === "error" || answer.stopReason === "aborted") {
        return {
          isError: true,
          output: text(
            toolResult("advisor-failed", {
              ERROR: answer.errorMessage ?? answer.stopReason,
            })
          ),
          usage: answer.usage,
        };
      }
      return { output: text(texts(answer.content)), usage: answer.usage };
    },
    name: "ask_advisor",
    parameters: Type.Object({
      question: Type.String({
        description:
          "What you need advice on, with the errors and what you tried when you're stuck",
      }),
    }),
  });
