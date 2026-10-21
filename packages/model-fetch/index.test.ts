import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { modelFetch } from "./index.ts";

const ENV = {
  CLOUDFLARE_ACCOUNT_ID: "acct",
  CLOUDFLARE_API_KEY: "key",
  CLOUDFLARE_GATEWAY_ID: "gw",
};
const CALL = { metadata: { agent: "coder", draftId: "d1", jobId: "d1-c1" } };

// What pi-ai's Anthropic client sends to `http://models.internal/anthropic`.
const piRequest = (model: string) =>
  new Request("http://models.internal/anthropic/v1/messages?beta=true", {
    body: JSON.stringify({
      messages: [
        {
          content: [{ cache_control: null, text: "hi", type: "text" }],
          role: "user",
        },
      ],
      model,
      stream: true,
      system: [
        { text: "one", type: "text" },
        { text: "two", type: "text" },
      ],
    }),
    headers: { "content-type": "application/json", "x-api-key": "placeholder" },
    method: "POST",
  });

const stubUpstream = (response = new Response("ok")) =>
  mock.method(globalThis, "fetch", () => Promise.resolve(response));
const sent = (upstream: ReturnType<typeof stubUpstream>) => {
  const [url, init] = upstream.mock.calls[0].arguments as unknown as [
    string,
    RequestInit,
  ];
  return {
    body: JSON.parse(init.body as string),
    headers: init.headers as Headers,
    url,
  };
};

test("Haiku 5.5 goes to Cloudflare REST through the shim", async (t) => {
  const upstream = stubUpstream();
  t.after(() => upstream.mock.restore());
  await modelFetch(piRequest("claude-haiku-5-5"), ENV, CALL);
  const { body, headers, url } = sent(upstream);
  assert.equal(
    url,
    "https://api.cloudflare.com/client/v4/accounts/acct/ai/v1/messages"
  );
  assert.equal(headers.get("authorization"), "Bearer key");
  assert.equal(headers.get("x-api-key"), null);
  assert.equal(headers.get("cf-aig-metadata"), JSON.stringify(CALL.metadata));
  assert.equal(headers.get("cf-aig-collect-log-payload"), "false");
  assert.equal(body.model, "anthropic/claude-haiku-5.5");
  assert.equal(body.system, "one\n\ntwo");
  assert.deepEqual(body.messages[0].content[0], { text: "hi", type: "text" });
});

test("Sonnet 5.5 goes to the gateway's /anthropic route untouched", async (t) => {
  const upstream = stubUpstream();
  t.after(() => upstream.mock.restore());
  const request = piRequest("claude-sonnet-5-5");
  const original = await request.clone().json();
  await modelFetch(request, ENV, CALL);
  const { body, headers, url } = sent(upstream);
  assert.equal(
    url,
    "https://gateway.ai.cloudflare.com/v1/acct/gw/anthropic/v1/messages?beta=true"
  );
  assert.equal(headers.get("cf-aig-authorization"), "Bearer key");
  assert.equal(headers.get("authorization"), null);
  assert.equal(headers.get("x-api-key"), null);
  assert.equal(headers.get("cf-aig-metadata"), JSON.stringify(CALL.metadata));
  assert.deepEqual(body, original);
});

test("the eval keeps full gateway logs", async (t) => {
  const upstream = stubUpstream();
  t.after(() => upstream.mock.restore());
  await modelFetch(piRequest("claude-sonnet-5-5"), ENV, {
    ...CALL,
    logPayload: true,
  });
  assert.equal(sent(upstream).headers.get("cf-aig-collect-log-payload"), null);
});

test("a 429 reaches the caller unchanged, with no retry", async (t) => {
  const limited = new Response("slow down", { status: 429 });
  const upstream = stubUpstream(limited);
  t.after(() => upstream.mock.restore());
  const response = await modelFetch(piRequest("claude-haiku-5-5"), ENV, CALL);
  assert.equal(response, limited);
  assert.equal(upstream.mock.callCount(), 1);
});
