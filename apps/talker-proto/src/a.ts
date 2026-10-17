/* oxlint-disable consistent-function-scoping, method-signature-style, no-await-in-loop, no-non-null-assertion, no-this-alias, no-this-assignment, no-unused-vars, no-use-before-define, no-void, parameter-properties, require-await -- PROTOTYPE (#128): throwaway code on prototype/talker-framework */
// PROTOTYPE (#128): Talker A. pi-durable owns the run (transcript, inbox of steers, model calls, tool tasks, recovery);
// PiHarness opens it on the object's SQLite and its Lifecycle heartbeat wakes the object after an eviction. Our part is
// the Effect service around it, the HTTP/WebSocket glue, and the build tool. Events reach the app as pi's snapshot
// followed by live batches; there is no cursor, so every (re)connect gets a fresh snapshot.
import { Type } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import type {
  AgentEventStream,
  ToolRegistration,
} from "@earendil-works/pi-durable";
import { PiHarness } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { createAI } from "agents/models/pi-ai";
import { WebSockets } from "agents/websockets";
import { DurableObject } from "cloudflare:workers";
import { Context, Effect, Layer, ManagedRuntime } from "effect";

interface Env {
  AI: Ai;
  TALKER: DurableObjectNamespace<TalkerA>;
  CODER_URL: string;
  CLOUDFLARE_GATEWAY_ID: string;
  CLOUDFLARE_ACCOUNT_ID: string;
}

const SYSTEM = `You are the Maker's Talker in a game-making app. Keep replies to one or two short sentences. When the
Creator asks for a game or a change, call build once with a precise spec, then tell them what changed.`;
// Sonnet goes through the AI binding (gateway, Unified Billing). Haiku 5.5 is not billed there yet (401, spike A), so it
// uses pi-ai's own Anthropic provider (Bearer from ANTHROPIC_AUTH_TOKEN) and the fetch rewrite below.
const MODELS = {
  haiku: { id: "claude-haiku-5-5", provider: "anthropic" },
  sonnet: { id: "anthropic/claude-sonnet-5-5", provider: "cloudflare" },
} as const;

// ponytail: send pi's Anthropic requests to Cloudflare's REST /ai/v1/messages instead, which rejects `?beta=true` and
// a content-block `system` or a system message, and names the model `anthropic/claude-haiku-5.5`. Delete once the gateway bills Haiku 5.5.
let accountId = "";
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (
    !url.startsWith("https://api.anthropic.com/v1/messages") ||
    typeof init?.body !== "string"
  ) {
    return realFetch(input, init);
  }
  type Text = string | { text: string }[];
  const text = (value: Text | undefined) =>
    Array.isArray(value)
      ? value.map((part) => part.text).join("\n\n")
      : (value ?? "");
  const body = JSON.parse(init.body) as {
    model: string;
    system?: Text;
    messages: { role: string; content: Text }[];
  };
  body.model = "anthropic/claude-haiku-5.5";
  // pi's Anthropic descriptor sends its system prompt as a mid-conversation system message; Cloudflare wants it on top.
  const system = [
    text(body.system),
    ...body.messages
      .filter((m) => m.role === "system")
      .map((m) => text(m.content)),
  ];
  body.system = system.filter(Boolean).join("\n\n");
  body.messages = body.messages.filter((m) => m.role !== "system");
  // pi's adaptive thinking carries `block_binding`, which Cloudflare's validator does not know.
  delete (body as { thinking?: { block_binding?: unknown } }).thinking
    ?.block_binding;
  return realFetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/messages`,
    {
      ...init,
      body: JSON.stringify(body),
    }
  );
};

class PiError {
  readonly _tag = "PiError";
  constructor(readonly cause: unknown) {}
}

// pi-durable wrapped as an Effect service: every call is a promise, so each method is one Effect.tryPromise.
class Pi extends Context.Service<
  Pi,
  {
    readonly submit: (
      text: string,
      operationId: string
    ) => Effect.Effect<{ accepted: boolean }, PiError>;
    readonly steer: (
      text: string,
      operationId: string
    ) => Effect.Effect<{ accepted: boolean }, PiError>;
    readonly abort: Effect.Effect<boolean, PiError>;
    readonly busy: Effect.Effect<boolean, PiError>;
    readonly setModel: (
      model: keyof typeof MODELS
    ) => Effect.Effect<void, PiError>;
    readonly events: Effect.Effect<AgentEventStream, PiError>;
    readonly messages: Effect.Effect<unknown, PiError>;
  }
>()("talker/Pi") {}

const piLayer = (harness: PiHarness) => {
  const call = <A>(f: () => Promise<A>) =>
    Effect.tryPromise({ catch: (cause) => new PiError(cause), try: f });
  const root = harness.session();
  return Layer.succeed(Pi, {
    abort: call(() => root.abort()),
    busy: call(() => root.busy()),
    events: call(() => root.events()),
    messages: call(() => root.messages()),
    setModel: (model) => call(() => root.setModel(MODELS[model])),
    steer: (text, operationId) => call(() => root.steer(text, { operationId })),
    submit: (text, operationId) =>
      call(() => root.submit(text, { operationId })),
  });
};

export class TalkerA extends DurableObject<Env> {
  instance = crypto.randomUUID().slice(0, 4);
  ai = createAI({ binding: this.env.AI, id: this.env.CLOUDFLARE_GATEWAY_ID });
  registry = createRegistry();
  harness = new PiHarness({
    defaults: { model: MODELS.sonnet, thinkingLevel: "low" },
    harness: ({ storage, context }) => {
      const models = createModels();
      models.setProvider(this.ai.provider);
      models.setProvider(anthropicProvider());
      return Harness.open(
        storage,
        { models, registry: this.registry },
        context
      );
    },
  });
  // Lifecycle owns the object's fetch/alarm/webSocket* handlers and declines upgrades unless this capability claims
  // them. `protocol: () => false` turns off the Agent protocol frames, so the socket carries only our messages.
  webSockets = new WebSockets({
    handlers: {
      onClose: (connection) => void this.streams.get(connection.id)?.stop(),
      // `?nostream` (prototype check only): accept the socket without a pi stream, to see what keeps the object awake.
      onConnect: (connection, { request }) =>
        new URL(request.url).searchParams.has("nostream")
          ? undefined
          : this.runtime.runPromise(this.attach(connection)),
    },
    protocol: () => false,
  });
  lifecycle = Lifecycle.install(this).use(this.harness).use(this.webSockets);
  runtime = ManagedRuntime.make(piLayer(this.harness));
  // One pi event stream per socket. Streams live in memory: after hibernation or a restart the sockets are still held
  // but their streams are gone, so onStart re-attaches every held socket with a fresh snapshot.
  streams = new Map<string, AgentEventStream>();

  attach(connection: { id: string; send(message: string): void }) {
    const self = this;
    return Effect.gen(function* () {
      const stream = yield* (yield* Pi).events;
      self.streams.set(connection.id, stream);
      connection.send(
        JSON.stringify({ data: stream.snapshot, type: "snapshot" })
      );
      stream.start(async (events) =>
        connection.send(JSON.stringify({ data: events, type: "batch" }))
      );
      console.log(
        `[A ${self.instance}] socket ${connection.id.slice(0, 6)}: snapshot, ${stream.snapshot.entries.length} entries`
      );
    });
  }

  async onStart() {
    for (const connection of this.webSockets.getConnections()) {
      await this.runtime.runPromise(this.attach(connection));
    }
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    accountId = env.CLOUDFLARE_ACCOUNT_ID;
    this.registry.install({
      name: "talker",
      sections: [{ key: "preamble", render: () => SYSTEM, tag: false }],
      tools: [this.buildTool()],
    });
    console.log(`[A ${this.instance}] constructor`);
  }

  // The job id is memoized in pi's storage for this call, so a replay after an eviction re-attaches to the same job.
  buildTool(): ToolRegistration<typeof BuildParams> {
    const draft = this.ctx.id.name ?? "draft";
    return {
      description:
        "Have the Coder build or change the game. Takes about a minute. Returns the Coder's report.",
      async execute({ spec }, api, context) {
        const jobId = await api.memo(
          "jobId",
          `${draft}-${api.callId}`,
          context
        );
        const url = `${coderUrl}/jobs/${jobId}`;
        console.log(`[A] build attach ${jobId}`);
        const signal = context.abortSignal;
        const onAbort = () => void fetch(`${url}/cancel`, { method: "POST" });
        signal?.addEventListener("abort", onAbort);
        const response = await fetch(url, {
          body: spec,
          method: "POST",
          signal,
        });
        let all = "";
        const decoder = new TextDecoder();
        for await (const chunk of response.body!) {
          const text = decoder.decode(chunk as Uint8Array, { stream: true });
          api.output(text);
          all += text;
        }
        const last = all.trim().split("\n").at(-1) ?? "";
        signal?.removeEventListener("abort", onAbort);
        return { output: [{ text: last, type: "text" }] };
      },
      name: "build",
      parameters: BuildParams,
      replay: "safe",
    };
  }

  // Lifecycle owns fetch/alarm/webSocket*: our requests arrive here and run as Effects.
  onRequest(request: Request) {
    coderUrl = this.env.CODER_URL;
    const self = this;
    const url = new URL(request.url);
    return this.runtime.runPromise(
      Effect.gen(function* () {
        const pi = yield* Pi;
        const action = url.pathname.split("/").at(-1);
        if (action === "messages") {
          return Response.json(yield* pi.messages);
        }
        if (action === "stop") {
          return Response.json({ stopped: yield* pi.abort });
        }
        if (action === "message") {
          const body = (yield* Effect.promise(() => request.json())) as {
            model?: "haiku" | "sonnet";
            text: string;
            id?: string;
          };
          const operationId = body.id ?? crypto.randomUUID();
          if (yield* pi.busy) {
            return Response.json({
              steer: true,
              ...(yield* pi.steer(body.text, operationId)),
            });
          }
          yield* pi.setModel(body.model ?? "sonnet");
          return Response.json(yield* pi.submit(body.text, operationId));
        }
        return new Response("not found", { status: 404 });
      })
    );
  }
}

const BuildParams = Type.Object({ spec: Type.String() });
let coderUrl = "http://localhost:8790";

export default {
  fetch(request: Request, env: Env) {
    const draft = new URL(request.url).pathname.split("/")[2] ?? "proto";
    return env.TALKER.getByName(draft).fetch(request);
  },
};
