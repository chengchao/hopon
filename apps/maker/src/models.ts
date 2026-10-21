// The eval's candidates and judge (#115), as pi-ai models. Claude goes through the shared modelFetch (#136), the
// production path: pi-ai talks to `http://models.internal/anthropic`, as in the Coder's Container, and the fetch below
// hands those requests to modelFetch in-process. Kimi K3 stays on the gateway's OpenAI-compatible route for re-runs.
// #116 picked Haiku 5.5 for both agents. DeepSeek and Kimi K2.6 were tried and dropped (eval/results/2026-10-20.md).
import { createModels, createProvider } from "@earendil-works/pi-ai";
import type { Api, Model, MutableModels } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import { cloudflareAIGatewayAuth } from "@earendil-works/pi-ai/providers/cloudflare-auth";
import { cloudflareStreams } from "@earendil-works/pi-ai/providers/cloudflare-stream";
import { modelFetch } from "@hopon/model-fetch";
import type { ModelEnv } from "@hopon/model-fetch";

const MODELS_HOST = "models.internal";
// pi's Anthropic client wants a key; modelFetch swaps in the real one, as the Coder's outbound handler will.
const PLACEHOLDER_KEY = MODELS_HOST;

// The gateway's descriptor, not Anthropic's: Anthropic's turns on mid-conversation system messages, which
// Cloudflare's REST endpoint for Haiku rejects ("messages[1].role").
const claude = (
  id: "claude-haiku-5-5" | "claude-sonnet-5-5" | "claude-opus-5-5"
): Model<Api> => ({
  ...getBuiltinModel("cloudflare-ai-gateway", id),
  baseUrl: `http://${MODELS_HOST}/anthropic`,
  provider: "anthropic",
});

// The eval's calls keep full gateway logs (#125), tagged apart from any Draft's.
let routed = false;
const routeModels = () => {
  if (routed) {
    return;
  }
  routed = true;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).host !== MODELS_HOST) {
      return realFetch(input, init);
    }
    return modelFetch(
      new Request(input, init),
      process.env as unknown as ModelEnv,
      {
        logPayload: true,
        metadata: { agent: "eval", draftId: "eval" },
      }
    );
  };
};

export const CANDIDATES = {
  "claude-haiku-5-5": () => claude("claude-haiku-5-5"),
  "claude-sonnet-5-5": () => claude("claude-sonnet-5-5"),
  // Moonshot's descriptor (prices, reasoning, compat) on the gateway's OpenAI-compatible route, which serves it on
  // Unified Billing (checked 2026-10-19: keySource "Unified", images in tool results, reasoning_effort low).
  "kimi-k3": (): Model<Api> => ({
    ...(getBuiltinModel("moonshotai", "kimi-k3") as Model<Api>),
    baseUrl:
      "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat",
    id: "moonshotai/kimi-k3",
    provider: "cloudflare-ai-gateway",
  }),
} as const;
export type Candidate = keyof typeof CANDIDATES;
export const isCandidate = (id: string): id is Candidate => id in CANDIDATES;

export const JUDGE = () => claude("claude-opus-5-5");

// modelFetch's keys (Claude) and the gateway's (Kimi), so a run fails before it starts rather than on its first request.
const KEYS = [
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_GATEWAY_ID",
] as const;
export const apiKey = (model: Model<Api>) =>
  model.provider === "anthropic"
    ? PLACEHOLDER_KEY
    : (process.env.CLOUDFLARE_API_KEY ?? "");

export const resolve = (id: string) => {
  if (!isCandidate(id)) {
    throw new Error(
      `unknown model ${id}; one of ${Object.keys(CANDIDATES).join(", ")}`
    );
  }
  const model = CANDIDATES[id]();
  const missing = KEYS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`${missing.join(", ")} missing from apps/maker/.env`);
  }
  routeModels();
  return model;
};

// pi-durable resolves {provider, modelId} against each provider's catalog, and the gateway's doesn't list Kimi K3, so
// the Talker gets it from a provider of its own with the same streams and auth.
const CF_COMPAT = "cloudflare-compat";
export const talkerModelRef = (model: Model<Api>) => ({
  modelId: model.id,
  provider: model.id === "moonshotai/kimi-k3" ? CF_COMPAT : model.provider,
});

// pi-durable's model registry (the Talker, the judge): the same routes.
export const createRegistry = (): MutableModels => {
  routeModels();
  const models = createModels();
  models.setProvider(
    createProvider({
      api: anthropicMessagesApi(),
      auth: {
        apiKey: {
          name: "modelFetch",
          resolve: () =>
            Promise.resolve({
              auth: { apiKey: PLACEHOLDER_KEY },
              source: MODELS_HOST,
            }),
        },
      },
      id: "anthropic",
      models: [
        CANDIDATES["claude-haiku-5-5"](),
        CANDIDATES["claude-sonnet-5-5"](),
        JUDGE(),
      ],
    })
  );
  models.setProvider(
    createProvider({
      api: cloudflareStreams(openAICompletionsApi()),
      auth: { apiKey: cloudflareAIGatewayAuth() },
      id: CF_COMPAT,
      models: [{ ...CANDIDATES["kimi-k3"](), provider: CF_COMPAT }],
    })
  );
  return models;
};
