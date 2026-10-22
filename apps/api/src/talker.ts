import type { FetchFunction } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
// The Talker (ADR 0003, #128): one Durable Object per Draft, running pi-durable through PiHarness on the Agent class.
// pi owns the run: the transcript, queued steers, model calls, and resuming after an eviction. Ours is the Effect
// service around pi, the requests the Worker forwards, and the sockets: every connect gets pi's snapshot of the
// conversation, then live batches (#128). Builds come with the `build` tool (#143).
import { createModels, createProvider } from "@earendil-works/pi-ai/models";
import { CLOUDFLARE_AI_GATEWAY_MODELS } from "@earendil-works/pi-ai/providers/cloudflare-ai-gateway.models";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import type {
  AgentEventStream,
  SubmissionId,
} from "@earendil-works/pi-durable";
import { modelFetch } from "@hopon/model-fetch";
import { Agent } from "agents";
import type { Connection } from "agents";
import { PiHarness } from "agents/harness/pi";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Context, Data, Effect, Layer, ManagedRuntime } from "effect";

import { drafts, now } from "./schema.ts";
import { TALKER_PROMPT } from "./talker-prompt.ts";

// pi's Anthropic client posts to this host, and its `fetch` hands each request to modelFetch in-process, which adds
// the key, routes the model and tags the call with the Draft (#136). The key pi wants is never sent.
const MODELS_URL = "http://models.internal/anthropic";

// The gateway's descriptor, not Anthropic's, whose mid-conversation system messages Cloudflare's endpoint for Haiku
// rejects (apps/maker/src/models.ts).
const talkerModels = (env: Env, draftId: string) => {
  const api = anthropicMessagesApi();
  const fetch: FetchFunction = (input, init) =>
    modelFetch(new Request(input, init), env, {
      metadata: { agent: "talker", draftId },
    });
  const models = createModels();
  models.setProvider(
    createProvider({
      api: {
        stream: (model, context, options) =>
          api.stream(model, context, { ...options, fetch }),
        streamSimple: (model, context, options) =>
          api.streamSimple(model, context, { ...options, fetch }),
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
          ...CLOUDFLARE_AI_GATEWAY_MODELS[env.MAKER_TALKER_MODEL],
          baseUrl: MODELS_URL,
          provider: "anthropic",
        },
      ],
    })
  );
  return models;
};

class PiError extends Data.TaggedError("PiError")<{
  readonly cause: unknown;
}> {}

const call = <A>(f: () => Promise<A>) =>
  Effect.tryPromise({ catch: (cause) => new PiError({ cause }), try: f });

// pi at the edge: every call is a promise, so each method is one Effect.tryPromise.
class Pi extends Context.Service<
  Pi,
  {
    // A message while a turn runs joins it as a steer, after the current tool round.
    readonly send: (text: string) => Effect.Effect<string, PiError>;
    readonly abort: Effect.Effect<boolean, PiError>;
    readonly busy: Effect.Effect<boolean, PiError>;
    readonly events: Effect.Effect<AgentEventStream, PiError>;
  }
>()("hopon/api/Pi") {}

const piLayer = (harness: PiHarness) => {
  const root = harness.session();
  return Layer.succeed(Pi, {
    abort: call(() => root.abort()),
    busy: call(() => root.busy()),
    events: call(() => root.events()),
    send: (text) =>
      call(async () => {
        const receipt = await root.submit(text, { whenBusy: "steer" });
        return receipt.operationId;
      }),
  });
};

// What the app's socket carries: pi's snapshot and batches, a tick every 15 s while a turn runs (#111's 40 s silence
// rule needs one during a long model call), and each message's outcome, from pi's submission records.
type Frame =
  | { type: "snapshot"; data: AgentEventStream["snapshot"] }
  | { type: "batch"; data: unknown }
  | { type: "tick" }
  | { type: "turn_done"; id: SubmissionId }
  | { type: "turn_failed"; id: SubmissionId; reason: string };

const TICK_MS = 15_000;
const TICKET_MS = 60_000;
// The app sends "ping" every 20 s (#126). A socket that died without closing stays in getWebSockets(), even across
// hibernation, so one with no ping for this long is closed.
const SILENT_MS = 60_000;

export class Talker extends Agent<Env> {
  harness = new PiHarness({
    defaults: {
      model: { id: this.env.MAKER_TALKER_MODEL, provider: "anthropic" },
      thinkingLevel: this.env.MAKER_TALKER_EFFORT,
    },
    harness: ({ storage, context }) => {
      const registry = createRegistry();
      registry.install({
        name: "talker",
        sections: [
          { key: "preamble", render: () => TALKER_PROMPT, tag: false },
        ],
      });
      // Retention 0: pi drops an idle conversation at once, so the object hibernates between turns (#128).
      return Harness.open(
        storage,
        {
          models: talkerModels(this.env, this.name),
          registry,
          settings: { contextRetentionMs: 0, documentRetentionMs: 0 },
        },
        context
      );
    },
  });
  runtime = ManagedRuntime.make(piLayer(this.harness));
  // pi's event streams live in memory, one per socket, so a wake re-attaches every held socket (onStart).
  streams = new Map<string, AgentEventStream>();
  // The object's own stream, which dates the D1 row at the end of each turn.
  watcher: AgentEventStream | undefined;
  ticker: ReturnType<typeof setInterval> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.lifecycle.use(this.harness);
    // Answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong")
    );
  }

  // oxlint-disable-next-line class-methods-use-this -- Agent's hook: the socket carries our frames only, not its protocol.
  shouldSendProtocolMessages() {
    return false;
  }

  attach(connection: Connection<{ since: number }>) {
    return Effect.gen({ self: this }, function* () {
      const stream = yield* (yield* Pi).events;
      yield* Effect.promise(
        async () => await this.streams.get(connection.id)?.stop()
      );
      this.streams.set(connection.id, stream);
      const send = (frame: Frame) => connection.send(JSON.stringify(frame));
      send({ data: stream.snapshot, type: "snapshot" });
      stream.start((events) => {
        send({ data: events, type: "batch" });
        for (const event of events) {
          if (event.type !== "submission") {
            continue;
          }
          const { id, status } = event.record;
          if (status === "done") {
            send({ id, type: "turn_done" });
          } else if (status === "unanswered") {
            send({ id, reason: event.record.reason, type: "turn_failed" });
          }
        }
        return Promise.resolve();
      });
    });
  }

  async watch() {
    if (this.watcher) {
      return;
    }
    this.watcher = await this.runtime.runPromise(Pi.use((pi) => pi.events));
    const db = drizzle(this.env.DB);
    this.watcher.start(async (events) => {
      if (events.some((event) => event.type === "run_end")) {
        clearInterval(this.ticker);
        this.ticker = undefined;
        await db
          .update(drafts)
          .set({ updatedAt: now })
          .where(eq(drafts.id, this.name));
      }
    });
  }

  // Until the run ends (watch), every socket hears something at least every 15 s, and dead ones are closed.
  tick() {
    if (this.ticker) {
      return;
    }
    this.ticker = setInterval(() => {
      const cutoff = Date.now() - SILENT_MS;
      for (const connection of this.getConnections<{ since: number }>()) {
        const pinged =
          this.ctx.getWebSocketAutoResponseTimestamp(connection)?.getTime() ??
          connection.state?.since ??
          0;
        if (pinged < cutoff) {
          connection.close(1001, "No ping");
        } else {
          connection.send(JSON.stringify({ type: "tick" } satisfies Frame));
        }
      }
    }, TICK_MS);
  }

  onConnect(connection: Connection<{ since: number }>) {
    connection.setState({ since: Date.now() });
    return this.runtime.runPromise(this.attach(connection));
  }

  async onClose(connection: Connection) {
    const stream = this.streams.get(connection.id);
    this.streams.delete(connection.id);
    await stream?.stop();
  }

  // After hibernation or an eviction the sockets are still held but their streams are gone; a run Lifecycle resumed
  // needs its ticks back.
  async onStart() {
    await this.watch();
    for (const connection of this.getConnections<{ since: number }>()) {
      // oxlint-disable-next-line no-await-in-loop -- one snapshot at a time is fine for a handful of sockets.
      await this.runtime.runPromise(this.attach(connection));
    }
    if (await this.harness.session().busy()) {
      this.tick();
    }
  }

  // One-time WebSocket tickets (#126): the Worker mints one for the owner and redeems it before forwarding the upgrade.
  async ticket() {
    const at = Date.now();
    const tickets = new Map(
      [
        ...((await this.ctx.storage.get<Map<string, number>>("tickets")) ?? []),
      ].filter(([, expires]) => expires > at)
    );
    const ticket = crypto.randomUUID();
    tickets.set(ticket, at + TICKET_MS);
    await this.ctx.storage.put("tickets", tickets);
    return ticket;
  }

  async redeem(ticket: string) {
    const tickets =
      (await this.ctx.storage.get<Map<string, number>>("tickets")) ?? new Map();
    const valid = (tickets.get(ticket) ?? 0) > Date.now();
    tickets.delete(ticket);
    await this.ctx.storage.put("tickets", tickets);
    return valid;
  }

  // The Worker's forwarded requests, after it has checked the owner and screened the text.
  onRequest(request: Request) {
    const action = new URL(request.url).pathname.slice(1);
    return this.runtime.runPromise(
      Effect.gen({ self: this }, function* () {
        const pi = yield* Pi;
        if (action === "message") {
          const { text } = yield* Effect.promise(() =>
            request.json<{ text: string }>()
          );
          const id = yield* pi.send(text);
          this.tick();
          return Response.json({ id }, { status: 202 });
        }
        if (action === "stop") {
          yield* pi.abort;
          return new Response(null, { status: 204 });
        }
        if (action === "ticket") {
          return Response.json({
            ticket: yield* Effect.promise(() => this.ticket()),
          });
        }
        if (action === "redeem") {
          const { ticket } = yield* Effect.promise(() =>
            request.json<{ ticket: string }>()
          );
          const valid = yield* Effect.promise(() => this.redeem(ticket));
          return new Response(null, { status: valid ? 204 : 404 });
        }
        return new Response(null, { status: 404 });
      })
    );
  }
}
