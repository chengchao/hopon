// The eval's models as pi-ai models: the candidates (#115). Claude goes to
// `http://models.internal/anthropic`, and the fetch below hands those requests to modelFetch (#136) in-process. Kimi
// K3 stays on the gateway's OpenAI-compatible route for re-runs. #116 picked Haiku 5.5 for both
// agents. DeepSeek and Kimi K2.6 were tried and dropped (eval/results/2026-10-20.md).
import { createModels, createProvider } from "@earendil-works/pi-ai";
import type { Api, Model, MutableModels } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import { cloudflareAIGatewayAuth } from "@earendil-works/pi-ai/providers/cloudflare-auth";
import { cloudflareStreams } from "@earendil-works/pi-ai/providers/cloudflare-stream";
import { MODELS_HOST, modelFetch } from "@hopon/model-fetch";
import type { ModelEnv } from "@hopon/model-fetch";

// pi's Anthropic client wants a key; modelFetch swaps in the real one.
const PLACEHOLDER_KEY = "placeholder";

// The gateway's descriptor, not Anthropic's: Anthropic's turns on mid-conversation system messages, which
// Cloudflare's REST endpoint for Haiku rejects ("messages[1].role").
const claude = (
  id: "claude-haiku-5-5" | "claude-sonnet-5-5" | "claude-opus-5-5"
): Model<Api> => ({
  ...getBuiltinModel("cloudflare-ai-gateway", id),
  baseUrl: `http://${MODELS_HOST}/anthropic`,
  provider: "anthropic",
});

// What answers pi-ai's requests to `http://models.internal`.
export type ModelHandler = (request: Request) => Promise<Response>;

// pi aborts a model request on a deadline or a cancel, and the abort has to end it. An abort
// that reaches the upstream fetch only through `new Request(input, init).signal` is lost once that Request is
// garbage-collected (undici follows the caller's signal through a WeakRef), and the read then waits out undici's 300 s
// body timeout: 4 eval runs hung 4–6 minutes on one request that way (PR #157). So the caller's own signal ends both
// the wait for headers and the body, whatever the handler does with it.
export const abortable =
  (handler: ModelHandler): typeof fetch =>
  async (input, init) => {
    const request = new Request(input, init);
    const signal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (!signal) {
      return await handler(request);
    }
    signal.throwIfAborted();
    const onAbort = Promise.withResolvers<never>();
    const abort = () => onAbort.reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    let response: Response;
    try {
      response = await Promise.race([handler(request), onAbort.promise]);
    } finally {
      signal.removeEventListener("abort", abort);
    }
    return response.body
      ? new Response(
          response.body.pipeThrough(new TransformStream(), { signal }),
          response
        )
      : response;
  };

// The eval's calls keep full gateway logs (#125), tagged apart from any Draft's.
const evalHandler: ModelHandler = (request) =>
  modelFetch(request, process.env as unknown as ModelEnv, {
    logPayload: true,
    metadata: { agent: "eval", draftId: "eval" },
  });

const realFetch = globalThis.fetch;

let handler: ModelHandler | undefined;
export const routeModels = (next: ModelHandler) => {
  if (!handler) {
    globalThis.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      return handler && new URL(url).host === MODELS_HOST
        ? abortable(handler)(input, init)
        : realFetch(input, init);
    };
  }
  handler = next;
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

// modelFetch's keys (Claude) and the gateway's (Kimi), so a run fails before it starts rather than on its first request.
const KEYS = [
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_GATEWAY_ID",
] as const satisfies readonly (keyof ModelEnv)[];
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
  routeModels(evalHandler);
  return model;
};

// pi-durable resolves {provider, modelId} against each provider's catalog, and the gateway's doesn't list Kimi K3, so
// the Talker gets it from a provider of its own with the same streams and auth.
const CF_COMPAT = "cloudflare-compat";
export const talkerModelRef = (model: Model<Api>) => ({
  modelId: model.id,
  provider: model.id === "moonshotai/kimi-k3" ? CF_COMPAT : model.provider,
});

// pi-durable's model registry (the Talker): the same routes.
export const createRegistry = (): MutableModels => {
  routeModels(evalHandler);
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
