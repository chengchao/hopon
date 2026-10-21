// Every Maker model call goes through here (#120, #136): the Talker in-process, the Coder's outbound handler for
// `http://models.internal/<provider>`, and the eval. It routes by provider prefix and the body's `model`, adds the key,
// and tags the call for the AI Gateway's logs, which are the only record (#120). Errors pass through; no retry.
// At launch the only route is `/anthropic/v1/messages`.

// The Worker's `env` or the eval's `process.env`.
export interface ModelEnv {
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_GATEWAY_ID: string;
  CLOUDFLARE_API_KEY: string;
}

export interface ModelCall {
  metadata: { draftId: string; agent: string; jobId?: string };
  // Production drops message text from the gateway's logs (#125); the eval keeps it.
  logPayload?: boolean;
}

const HAIKU = "claude-haiku-5-5";

// ponytail: Cloudflare's REST /v1/messages validates a narrower request than Anthropic's (#128 found four rewrites):
// its own model name, no `?beta=true`, `system` as one string, no nulls. Delete once the gateway bills Haiku 5.5.
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
const shimHaiku = (body: Record<string, unknown>) => {
  const shimmed = dropNulls(body) as {
    model: string;
    system?: string | { text: string }[];
  };
  shimmed.model = "anthropic/claude-haiku-5.5";
  if (Array.isArray(shimmed.system)) {
    shimmed.system = shimmed.system.map((part) => part.text).join("\n\n");
  }
  return shimmed;
};

export const modelFetch = async (
  request: Request,
  env: ModelEnv,
  call: ModelCall
): Promise<Response> => {
  const url = new URL(request.url);
  if (request.method !== "POST" || url.pathname !== "/anthropic/v1/messages") {
    return new Response("No model route", { status: 404 });
  }
  const text = await request.text();
  const body = JSON.parse(text) as Record<string, unknown>;
  const headers = new Headers(request.headers);
  for (const name of [
    "authorization",
    "x-api-key",
    "cf-aig-authorization",
    "content-length",
    "host",
  ]) {
    headers.delete(name);
  }
  headers.set("cf-aig-metadata", JSON.stringify(call.metadata));
  if (!call.logPayload) {
    headers.set("cf-aig-collect-log-payload", "false");
  }
  const haiku = body.model === HAIKU;
  if (haiku) {
    headers.set("authorization", `Bearer ${env.CLOUDFLARE_API_KEY}`);
  } else {
    headers.set("cf-aig-authorization", `Bearer ${env.CLOUDFLARE_API_KEY}`);
  }
  return await fetch(
    haiku
      ? `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1/messages`
      : `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.CLOUDFLARE_GATEWAY_ID}/anthropic/v1/messages${url.search}`,
    {
      body: haiku ? JSON.stringify(shimHaiku(body)) : text,
      headers,
      method: "POST",
      signal: request.signal,
    }
  );
};
