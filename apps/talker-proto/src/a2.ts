/* oxlint-disable class-methods-use-this, consistent-function-scoping, consistent-type-specifier-style, no-await-expression-member, no-await-in-loop, no-non-null-assertion, no-this-alias, no-this-assignment, no-void, parameter-properties, require-await -- PROTOTYPE (#128): throwaway code on prototype/talker-framework */
// PROTOTYPE (#128): Talker A2. The same pi-durable Talker as a.ts, but hosted the way the PiHarness docs show first:
// `class … extends Agent`, `this.lifecycle.use(this.harness)`. Agent brings the WebSocket handling (onConnect/onClose,
// hibernation); `shouldSendProtocolMessages` returns false so the socket carries only our frames. Sonnet only.
import { Type } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  type AgentEventStream,
  createRegistry,
  Harness,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import { Agent, type Connection, getAgentByName } from "agents";
import { PiHarness } from "agents/harness/pi";
import { createAI } from "agents/models/pi-ai";
import { Context, Effect, Layer, ManagedRuntime } from "effect";

interface Env {
  AI: Ai;
  TALKER: DurableObjectNamespace<TalkerAgent>;
  CODER_URL: string;
  PI_RETENTION_MS: string;
}

const SYSTEM = `You are the Maker's Talker in a game-making app. Keep replies to one or two short sentences. When the
Creator asks for a game or a change, call build once with a precise spec, then tell them what changed.`;
const SONNET = {
  id: "anthropic/claude-sonnet-5-5",
  provider: "cloudflare",
} as const;
const BuildParams = Type.Object({ spec: Type.String() });

class PiError {
  readonly _tag = "PiError";
  constructor(readonly cause: unknown) {}
}

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
    steer: (text, operationId) => call(() => root.steer(text, { operationId })),
    submit: (text, operationId) =>
      call(() => root.submit(text, { operationId })),
  });
};

export class TalkerAgent extends Agent<Env> {
  instance = crypto.randomUUID().slice(0, 4);
  ai = createAI({ binding: this.env.AI });
  registry = createRegistry();
  harness = new PiHarness({
    defaults: { model: SONNET, thinkingLevel: "low" },
    harness: ({ storage, context }) => {
      const models = createModels();
      models.setProvider(this.ai.provider);
      const retention =
        this.env.PI_RETENTION_MS === ""
          ? undefined
          : Number(this.env.PI_RETENTION_MS);
      const settings =
        retention === undefined
          ? undefined
          : { contextRetentionMs: retention, documentRetentionMs: retention };
      return Harness.open(
        storage,
        { models, registry: this.registry, settings },
        context
      );
    },
  });
  runtime = ManagedRuntime.make(piLayer(this.harness));
  streams = new Map<string, AgentEventStream>();
  ticker: ReturnType<typeof setInterval> | undefined;

  // #111's liveness rule: while a run is going, every socket hears something at least every 15 s. pi's own batches
  // don't guarantee that (a long model call is silent), so this ticks until pi says the session is idle.
  tick() {
    if (this.ticker) {
      return;
    }
    this.ticker = setInterval(async () => {
      if (!(await this.harness.session().busy())) {
        clearInterval(this.ticker);
        this.ticker = undefined;
        return;
      }
      for (const connection of this.getConnections()) {
        connection.send(JSON.stringify({ type: "tick" }));
      }
    }, 15_000);
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.lifecycle.use(this.harness);
    this.registry.install({
      name: "talker",
      sections: [{ key: "preamble", render: () => SYSTEM, tag: false }],
      tools: [this.buildTool()],
    });
    console.log(
      `[A2 ${this.instance}] constructor retention=${env.PI_RETENTION_MS || "default"}`
    );
  }

  buildTool(): ToolRegistration<typeof BuildParams> {
    const draft = this.ctx.id.name ?? "draft";
    const coder = this.env.CODER_URL;
    return {
      description:
        "Have the Coder build or change the game. Takes about a minute. Returns the Coder's report.",
      async execute({ spec }, api, context) {
        const jobId = await api.memo(
          "jobId",
          `${draft}-${api.callId}`,
          context
        );
        const url = `${coder}/jobs/${jobId}`;
        console.log(`[A2] build attach ${jobId}`);
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
        signal?.removeEventListener("abort", onAbort);
        return {
          output: [{ text: all.trim().split("\n").at(-1) ?? "", type: "text" }],
        };
      },
      name: "build",
      parameters: BuildParams,
      replay: "safe",
    };
  }

  shouldSendProtocolMessages() {
    return false;
  }

  attach(connection: Connection) {
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
        `[A2 ${self.instance}] socket ${connection.id.slice(0, 6)}: snapshot, ${stream.snapshot.entries.length} entries`
      );
    });
  }

  onConnect(connection: Connection) {
    return this.runtime.runPromise(this.attach(connection));
  }

  onClose(connection: Connection) {
    void this.streams.get(connection.id)?.stop();
  }

  // After hibernation or a restart the sockets are still held but their in-memory pi streams are gone.
  async onStart() {
    for (const connection of this.getConnections()) {
      await this.runtime.runPromise(this.attach(connection));
    }
    // A run Lifecycle resumed after an eviction needs its ticks back.
    if (await this.harness.session().busy()) {
      this.tick();
    }
  }

  onRequest(request: Request) {
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
            text: string;
          };
          const operationId = crypto.randomUUID();
          if (yield* pi.busy) {
            return Response.json({
              steer: true,
              ...(yield* pi.steer(body.text, operationId)),
            });
          }
          const receipt = yield* pi.submit(body.text, operationId);
          self.tick();
          return Response.json(receipt);
        }
        return new Response("not found", { status: 404 });
      })
    );
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const draft = new URL(request.url).pathname.split("/")[2] ?? "proto";
    return (await getAgentByName(env.TALKER, draft)).fetch(request);
  },
};
