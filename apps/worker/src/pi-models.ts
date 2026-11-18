// How the Maker reaches its model (#136, ADR 0006): pi-ai's Anthropic API, whose `fetch` hands each
// request to modelFetch in-process, which adds the key, routes the model and tags the call for the gateway's logs. The
// key pi wants is never sent.
import type { Api, FetchFunction, Model } from "@earendil-works/pi-ai";
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

// pi-ai 1.4.0's catalog stops at Fable 5.1. Fable 5.2 has 5.1's API at Anthropic's lower price.
const FABLE_5_1 = CLOUDFLARE_AI_GATEWAY_MODELS["claude-fable-5-1"];
const CATALOG: Record<string, Model<Api> | undefined> = {
  ...CLOUDFLARE_AI_GATEWAY_MODELS,
  "claude-fable-5-2": {
    ...FABLE_5_1,
    cost: { cacheRead: 0.2, cacheWrite: 10, input: 8, output: 40 },
    id: "claude-fable-5-2",
    name: "Claude Fable 5.2",
  },
};

// One pi provider per model the Maker calls, each with the gateway tag for its calls. The gateway's descriptor, not
// Anthropic's, whose mid-conversation system messages Cloudflare's endpoint for Haiku rejects. `metadata` is read per
// request, so a call is tagged with the job it serves.
export interface AgentModel {
  provider: string;
  model: string;
  metadata: () => ModelCall["metadata"];
}

export const piModels = (env: Env, agents: readonly AgentModel[]) => {
  const api = anthropicMessagesApi();
  const models = createModels();
  for (const { metadata, model, provider } of agents) {
    const entry = CATALOG[model];
    if (!entry) {
      throw new Error(`no model ${model} in pi-ai's catalog`);
    }
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
            ...entry,
            baseUrl: MODELS_URL,
            provider,
          },
        ],
      })
    );
  }
  return models;
};

// Every model call, the agent's and the advisor's, counts against the Draft owner's Allowance (ADR 0004), at pi's price
// for the response. A charge that fails is logged, never the turn's failure.
export const chargeCall = async (env: Env, draftId: string, cost: number) => {
  try {
    await charge(drizzle(env.DB), draftId, cost);
  } catch (error) {
    console.error(`Draft ${draftId}: not charged`, error);
  }
};

// pi awaits it before going on, so a turn's cost has landed by the time the turn ends. ponytail: a call Stop aborts
// mid-stream never reaches afterResponse, so it costs nothing; charge from the stream's own result if that leak ever
// matters.
export const metered = (env: Env, draftId: () => string) =>
  hook(GenerationTask, {
    afterResponse: (message) =>
      chargeCall(env, draftId(), message.usage.cost.total),
  });
