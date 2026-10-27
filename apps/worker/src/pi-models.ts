// How the Talker and the Coder reach their model (#136): pi-ai's Anthropic API, whose `fetch` hands each request to
// modelFetch in-process, which adds the key, routes the model and tags the call for the gateway's logs. The key pi
// wants is never sent.
import type { FetchFunction } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { createModels, createProvider } from "@earendil-works/pi-ai/models";
import { CLOUDFLARE_AI_GATEWAY_MODELS } from "@earendil-works/pi-ai/providers/cloudflare-ai-gateway.models";
import { modelFetch } from "@hopon/model-fetch";
import type { ModelCall } from "@hopon/model-fetch";

// pi's Anthropic client posts to this host; only modelFetch answers it.
const MODELS_URL = "http://models.internal/anthropic";

// The gateway's descriptor, not Anthropic's, whose mid-conversation system messages Cloudflare's endpoint for Haiku
// rejects (apps/maker/src/models.ts). `metadata` is read per request, so a call is tagged with the job it serves.
export const piModels = (
  env: Env,
  model: keyof typeof CLOUDFLARE_AI_GATEWAY_MODELS,
  metadata: () => ModelCall["metadata"]
) => {
  const api = anthropicMessagesApi();
  const fetch: FetchFunction = (input, init) =>
    modelFetch(new Request(input, init), env, { metadata: metadata() });
  const models = createModels();
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
      id: "anthropic",
      models: [
        {
          ...CLOUDFLARE_AI_GATEWAY_MODELS[model],
          baseUrl: MODELS_URL,
          provider: "anthropic",
        },
      ],
    })
  );
  return models;
};
