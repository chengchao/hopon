// The eval's candidates and judge (#115), as pi-ai models. Claude goes through the Cloudflare AI Gateway, except Haiku
// 5.5, which Unified Billing doesn't serve yet: it goes to Cloudflare's REST /ai/v1/messages. DeepSeek and Kimi go to
// their own APIs with their own keys.
import { createModels, createProvider } from "@earendil-works/pi-ai";
import type { Api, Model, MutableModels } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { getBuiltinModel } from "@earendil-works/pi-ai/providers/all";
import { cloudflareAIGatewayProvider } from "@earendil-works/pi-ai/providers/cloudflare-ai-gateway";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { moonshotaiProvider } from "@earendil-works/pi-ai/providers/moonshotai";

const CF_REST = "cloudflare-rest";
const restBaseUrl = () =>
  `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai`;

// The gateway's descriptor, not Anthropic's: Anthropic's turns on mid-conversation system messages, which
// Cloudflare's endpoint rejects ("messages[1].role").
const haiku = (): Model<Api> => ({
  ...getBuiltinModel("cloudflare-ai-gateway", "claude-haiku-5-5"),
  baseUrl: restBaseUrl(),
  headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_KEY}` },
  id: "anthropic/claude-haiku-5.5",
  provider: CF_REST,
});

// ponytail: Cloudflare's /v1/messages validates a narrower request than Anthropic's (#128 found four rewrites): no
// `?beta=true`, `system` as one string, no nulls. Delete once the gateway bills Haiku 5.5.
const dropNulls = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(dropNulls);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== null)
        .map(([key, item]) => [key, dropNulls(item)])
    );
  }
  return value;
};
let shimmed = false;
const shimCloudflareMessages = () => {
  if (shimmed) {
    return;
  }
  shimmed = true;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const messages = `${restBaseUrl()}/v1/messages`;
    if (!url.startsWith(messages) || typeof init?.body !== "string") {
      return realFetch(input, init);
    }
    const body = dropNulls(JSON.parse(init.body)) as {
      system?: string | { text: string }[];
    };
    if (Array.isArray(body.system)) {
      body.system = body.system.map((part) => part.text).join("\n\n");
    }
    return realFetch(messages, { ...init, body: JSON.stringify(body) });
  };
};

export const CANDIDATES = {
  "claude-haiku-5-5": haiku,
  "claude-sonnet-5-5": () =>
    getBuiltinModel("cloudflare-ai-gateway", "claude-sonnet-5-5") as Model<Api>,
  "deepseek-flash": () =>
    getBuiltinModel("deepseek", "deepseek-flash") as Model<Api>,
  "kimi-k3": () => getBuiltinModel("moonshotai", "kimi-k3") as Model<Api>,
} as const;
export type Candidate = keyof typeof CANDIDATES;
export const isCandidate = (id: string): id is Candidate => id in CANDIDATES;

export const JUDGE = () =>
  getBuiltinModel("cloudflare-ai-gateway", "claude-opus-5-5") as Model<Api>;

// The key each provider reads, so a run fails before it starts rather than on its first request.
const KEYS: Record<string, string[]> = {
  [CF_REST]: ["CLOUDFLARE_API_KEY", "CLOUDFLARE_ACCOUNT_ID"],
  "cloudflare-ai-gateway": [
    "CLOUDFLARE_API_KEY",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_GATEWAY_ID",
  ],
  deepseek: ["DEEPSEEK_API_KEY"],
  moonshotai: ["MOONSHOT_API_KEY"],
};
export const apiKey = (model: Model<Api>) =>
  process.env[KEYS[model.provider]?.[0] ?? ""] ?? "";

export const resolve = (id: string) => {
  if (!isCandidate(id)) {
    throw new Error(
      `unknown model ${id}; one of ${Object.keys(CANDIDATES).join(", ")}`
    );
  }
  const model = CANDIDATES[id]();
  const missing = (KEYS[model.provider] ?? []).filter(
    (name) => !process.env[name]
  );
  if (missing.length > 0) {
    throw new Error(`${missing.join(", ")} missing from apps/maker/.env`);
  }
  if (model.provider === CF_REST) {
    shimCloudflareMessages();
  }
  return model;
};

// pi-durable's model registry (the Talker): the same four routes.
export const createRegistry = (): MutableModels => {
  shimCloudflareMessages();
  const models = createModels();
  models.setProvider(cloudflareAIGatewayProvider());
  models.setProvider(deepseekProvider());
  models.setProvider(moonshotaiProvider());
  models.setProvider(
    createProvider({
      api: anthropicMessagesApi(),
      auth: {
        apiKey: {
          name: "Cloudflare API token",
          resolve: () =>
            Promise.resolve({
              auth: { apiKey: process.env.CLOUDFLARE_API_KEY ?? "" },
              source: "CLOUDFLARE_API_KEY",
            }),
        },
      },
      id: CF_REST,
      models: [haiku()],
    })
  );
  return models;
};
