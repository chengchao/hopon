// How the main and sub agents reach their models (#136, ADR 0005): pi-ai's Anthropic API, whose `fetch` hands each
// request to modelFetch in-process, which adds the key, routes the model and tags the call for the gateway's logs. The
// key pi wants is never sent.
import type { FetchFunction } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { createModels, createProvider } from "@earendil-works/pi-ai/models";
import { CLOUDFLARE_AI_GATEWAY_MODELS } from "@earendil-works/pi-ai/providers/cloudflare-ai-gateway.models";
import { GenerationTask, hook } from "@earendil-works/pi-durable";
import { modelFetch } from "@hopon/model-fetch";
import type { ModelCall } from "@hopon/model-fetch";
import { drizzle } from "drizzle-orm/d1";

import { charge } from "./storage.ts";

// pi's Anthropic client posts to this host; only modelFetch answers it.
const MODELS_URL = "http://models.internal/anthropic";

// One pi provider per agent, each with its model and the gateway tag for its calls, so a call is tagged by the agent
// that makes it. The gateway's descriptor, not Anthropic's, whose mid-conversation system messages Cloudflare's endpoint
// for Haiku rejects (apps/maker/src/models.ts). `metadata` is read per request, so a call is tagged with the job it
// serves.
export interface AgentModel {
  provider: string;
  model: keyof typeof CLOUDFLARE_AI_GATEWAY_MODELS;
  metadata: () => ModelCall["metadata"];
}

export const piModels = (env: Env, agents: readonly AgentModel[]) => {
  const api = anthropicMessagesApi();
  const models = createModels();
  for (const { metadata, model, provider } of agents) {
    const fetch: FetchFunction = (input, init) =>
      modelFetch(new Request(input, init), env, { metadata: metadata() });
    models.setProvider(
      createProvider({
        api: {
          stream: (descriptor, context, options) =>
            api.stream(descriptor, context, { ...options, fetch }),
          streamSimple: (descriptor, context, options) =>
            api.streamSimple(descriptor, context, { ...options, fetch }),
        },
        auth: {
          apiKey: {
            name: "modelFetch",
            resolve: () =>
              Promise.resolve({
                auth: { apiKey: "placeholder" },
                source: "modelFetch",
              }),
          },
        },
        id: provider,
        models: [
          {
            ...CLOUDFLARE_AI_GATEWAY_MODELS[model],
            baseUrl: MODELS_URL,
            provider,
          },
        ],
      })
    );
  }
  return models;
};

// Every model call of both agents counts against the Draft owner's Allowance (ADR 0004), at pi's price for the response.
// pi awaits it before going on, so a turn's cost has landed by the time the turn ends. A charge that fails is logged,
// never the turn's failure. ponytail: a call Stop aborts mid-stream never reaches afterResponse, so it costs nothing;
// charge from the stream's own result if that leak ever matters.
export const metered = (env: Env, draftId: () => string) =>
  hook(GenerationTask, {
    afterResponse: async (message) => {
      try {
        await charge(drizzle(env.DB), draftId(), message.usage.cost.total);
      } catch (error) {
        console.error(`Draft ${draftId()}: not charged`, error);
      }
    },
  });
