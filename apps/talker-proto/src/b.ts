/* oxlint-disable class-methods-use-this, no-empty, no-nested-ternary, no-non-null-assertion, no-this-alias, no-this-assignment, prefer-array-find -- PROTOTYPE (#128): throwaway code on prototype/talker-framework */
// PROTOTYPE (#128): Talker B. Our own step loop over effect/ai's LanguageModel and Toolkit, the Anthropic provider at
// the Cloudflare AI Gateway, and a numbered event log in the object's SQLite through @effect/sql-sqlite-do that a
// WebSocket replays with `since=N`. Stop interrupts the turn's fiber; the 5-minute cap is Effect.timeout. A turn that
// an eviction cut off is resumed by an alarm heartbeat from the history persisted after every model call and tool round.
import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic";
import { SqliteClient } from "@effect/sql-sqlite-do";
import { DurableObject } from "cloudflare:workers";
import {
  Cause,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Schema,
  Stream,
} from "effect";
import { LanguageModel, Prompt, Tool, Toolkit } from "effect/ai";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
import { SqlClient } from "effect/sql";

interface Env {
  TALKER: DurableObjectNamespace<TalkerB>;
  CODER_URL: string;
  CLOUDFLARE_API_KEY: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_GATEWAY_ID: string;
}

const STEPS = 12;
const TURN_MS = 5 * 60_000;
const SYSTEM = `You are the Maker's Talker in a game-making app. Keep replies to one or two short sentences. When the
Creator asks for a game or a change, call build once with a precise spec, then tell them what changed.`;

const Build = Tool.make("build", {
  description:
    "Have the Coder build or change the game. Takes about a minute. Returns the Coder's report.",
  parameters: Schema.Struct({ spec: Schema.String }),
  success: Schema.String,
});
const Tools = Toolkit.make(Build);

// Haiku 5.5 is not on the gateway's Unified Billing yet (spike A): it goes to Cloudflare's REST /ai/v1/messages, which
// rejects `?beta=true`, a `system` given as content blocks, and the `cache_control: null` Effect's provider puts on
// every block (Anthropic accepts it), so drop nulls too. ponytail: delete once the gateway bills Haiku 5.5.
const haikuRewrite = HttpClient.mapRequest((request) => {
  const body =
    request.body._tag === "Uint8Array"
      ? (JSON.parse(
          new TextDecoder().decode(request.body.body),
          (_key, value) => (value === null ? undefined : value)
        ) as { system?: string | { text: string }[] })
      : undefined;
  if (Array.isArray(body?.system)) {
    body.system = body.system.map((part) => part.text).join("\n\n");
  }
  const stripped = HttpClientRequest.setUrlParams(
    HttpClientRequest.setUrl(request, request.url.split("?")[0]),
    []
  );
  return body ? HttpClientRequest.bodyJsonUnsafe(stripped, body) : stripped;
});

// Its replies also omit `usage` keys Effect's response schema requires (nullable, but not optional), so add them.
const haikuResponse = HttpClient.transformResponse(
  Effect.flatMap((response) =>
    response.status >= 400
      ? Effect.succeed(response)
      : response.json.pipe(
          Effect.map((json) => {
            const body = json as { usage?: Record<string, unknown> };
            for (const key of [
              "cache_creation",
              "cache_creation_input_tokens",
              "cache_read_input_tokens",
              "service_tier",
            ]) {
              body.usage![key] ??= null;
            }
            return HttpClientResponse.fromWeb(
              response.request,
              Response.json(body, {
                headers: response.headers,
                status: response.status,
              })
            );
          })
        )
  )
);

const models = (env: Env) => {
  const bearer = (header: string) =>
    HttpClient.mapRequest(
      HttpClientRequest.setHeader(header, `Bearer ${env.CLOUDFLARE_API_KEY}`)
    );
  const sonnet = AnthropicLanguageModel.layer({
    config: { max_tokens: 2048 },
    model: "claude-sonnet-5-5",
  }).pipe(
    Layer.provide(
      AnthropicClient.layer({
        apiUrl: `https://gateway.ai.cloudflare.com/v1/${env.CLOUDFLARE_ACCOUNT_ID}/${env.CLOUDFLARE_GATEWAY_ID}/anthropic`,
        transformClient: bearer("cf-aig-authorization"),
      })
    ),
    Layer.provide(FetchHttpClient.layer)
  );
  const haiku = AnthropicLanguageModel.layer({
    config: { max_tokens: 2048 },
    model: "anthropic/claude-haiku-5.5",
  }).pipe(
    Layer.provide(
      AnthropicClient.layer({
        apiUrl: `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai`,
        transformClient: (client) =>
          haikuResponse(haikuRewrite(bearer("authorization")(client))),
      })
    ),
    Layer.provide(FetchHttpClient.layer)
  );
  return { haiku, sonnet };
};

type ModelName = "haiku" | "sonnet";
const History = Schema.fromJsonString(Prompt.Prompt);

export class TalkerB extends DurableObject<Env> {
  fiber: Fiber.Fiber<void, unknown> | undefined;
  instance = crypto.randomUUID().slice(0, 4);
  runtime;
  models;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.models = models(env);
    // Tool handlers may not require services, so the layer captures them once.
    const self = this;
    const tools = Tools.toLayer(
      Effect.gen(function* () {
        const services = yield* Effect.context<
          SqlClient.SqlClient | HttpClient.HttpClient
        >();
        return {
          build: ({ spec }, { toolCallId }) =>
            self
              .build(spec, toolCallId ?? "none")
              .pipe(Effect.provideContext(services)),
        };
      })
    );
    this.runtime = ManagedRuntime.make(
      tools.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            SqliteClient.layer({ db: ctx.storage.sql }),
            FetchHttpClient.layer
          )
        )
      )
    );
    ctx.blockConcurrencyWhile(() =>
      this.run(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, turn INTEGER, type TEXT, data TEXT)`;
          yield* sql`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`;
          yield* sql`CREATE TABLE IF NOT EXISTS inbox (id INTEGER PRIMARY KEY, text TEXT)`;
        })
      )
    );
    console.log(`[B ${this.instance}] constructor`);
  }

  run<A>(
    effect: Effect.Effect<
      A,
      unknown,
      | SqlClient.SqlClient
      | Tool.HandlersFor<typeof Tools.tools>
      | HttpClient.HttpClient
    >
  ) {
    return this.runtime.runPromise(effect);
  }

  // ---- state in SQLite ----
  get = (k: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ v: string }>`SELECT v FROM kv WHERE k = ${k}`;
      return rows[0]?.v;
    });
  set = (k: string, v: string | undefined) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* v === undefined
        ? sql`DELETE FROM kv WHERE k = ${k}`
        : sql`INSERT INTO kv (k, v) VALUES (${k}, ${v}) ON CONFLICT (k) DO UPDATE SET v = excluded.v`;
    });

  append = (turn: number, type: string, data: unknown = {}) => {
    const self = this;
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{
        seq: number;
      }>`INSERT INTO events (seq, turn, type, data)
        VALUES ((SELECT coalesce(max(seq), 0) + 1 FROM events), ${turn}, ${type}, ${JSON.stringify(data)}) RETURNING seq`;
      self.broadcast({ data, seq: rows[0].seq, turn, type });
      console.log(
        `[B ${self.instance}] #${rows[0].seq} ${type} ${JSON.stringify(data).slice(0, 100)}`
      );
    });
  };

  broadcast(message: unknown) {
    const text = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {}
    }
  }

  history = () =>
    this.get("history").pipe(
      Effect.flatMap((json) =>
        json
          ? Schema.decodeEffect(History)(json)
          : Effect.succeed(Prompt.make([{ content: SYSTEM, role: "system" }]))
      )
    );
  saveHistory = (prompt: Prompt.Prompt) =>
    Schema.encodeEffect(History)(prompt).pipe(
      Effect.flatMap((json) => this.set("history", json))
    );

  // ---- the tool: re-attaches by a job id derived from the tool call id, so a rerun after eviction attaches ----
  build(spec: string, toolCallId: string) {
    const jobId = `${this.ctx.id.name ?? "draft"}-${toolCallId}`;
    const url = `${this.env.CODER_URL}/jobs/${jobId}`;
    const self = this;
    return Effect.gen(function* () {
      const turn = Number(yield* self.get("turn"));
      yield* self.append(turn, "build_attach", { jobId });
      const http = yield* HttpClient.HttpClient;
      const response = yield* http.execute(
        HttpClientRequest.post(url).pipe(HttpClientRequest.bodyText(spec))
      );
      let last = "";
      yield* response.stream.pipe(
        Stream.decodeText,
        Stream.splitLines,
        Stream.runForEach((line) => {
          last = line;
          return line.endsWith("0/60") || !line.startsWith("progress")
            ? self.append(turn, "build_progress", { line })
            : Effect.void;
        })
      );
      return last;
    }).pipe(
      Effect.onInterrupt(() =>
        Effect.promise(() => fetch(`${url}/cancel`, { method: "POST" })).pipe(
          Effect.ignore
        )
      ),
      Effect.orDie
    );
  }

  // ---- the loop ----
  turnLoop(turn: number) {
    const self = this;
    return Effect.gen(function* () {
      const toolkit = yield* Tools;
      const model = ((yield* self.get("model")) ?? "sonnet") as ModelName;
      for (
        let step = Number((yield* self.get("step")) ?? 0) + 1;
        step <= STEPS;
        step += 1
      ) {
        yield* self.set("step", String(step));
        let history = yield* self.history();
        // Steers queued while the last step ran join the conversation here.
        const sql = yield* SqlClient.SqlClient;
        const steers = yield* sql<{
          id: number;
          text: string;
        }>`DELETE FROM inbox RETURNING id, text`;
        for (const steer of steers) {
          history = Prompt.concat(history, Prompt.make(steer.text));
          yield* self.append(turn, "steer_applied", { text: steer.text });
        }
        // Tool calls without results: an eviction cut the last round off, so run it again (build re-attaches).
        const last = history.content.at(-1);
        const pending =
          last?.role === "assistant"
            ? last.content.filter((part) => part.type === "tool-call")
            : [];
        if (pending.length === 0) {
          const response = yield* LanguageModel.generateText({
            disableToolCallResolution: true,
            prompt: history,
            toolkit,
          }).pipe(Effect.provide(self.models[model]));
          history = Prompt.concat(
            history,
            Prompt.fromResponseParts(response.content)
          );
          yield* self.saveHistory(history);
          yield* self.append(turn, "assistant", {
            step,
            text: response.text,
            toolCalls: response.toolCalls.map((call) => ({
              id: call.id,
              name: call.name,
              params: call.params,
            })),
            usage: response.usage,
          });
          if (response.toolCalls.length === 0) {
            if (
              steers.length === 0 &&
              (yield* sql`SELECT 1 FROM inbox`).length === 0
            ) {
              return;
            }
            continue;
          }
        } else {
          yield* self.append(turn, "resume_tool_round", {
            calls: pending.map((part) => part.id),
            step,
          });
        }
        const calls = (
          history.content.at(-1) as Prompt.AssistantMessage
        ).content.filter((part) => part.type === "tool-call");
        const results = [];
        for (const call of calls) {
          const stream = yield* toolkit.handle(
            call.name as "build",
            call.params as { spec: string },
            call.id
          );
          const final = (yield* Stream.runCollect(stream))
            .filter((result) => !result.preliminary)
            .at(-1);
          results.push(
            Prompt.makePart("tool-result", {
              id: call.id,
              isFailure: final?.isFailure ?? true,
              name: call.name,
              providerExecuted: false,
              result: final?.encodedResult ?? "no result",
            })
          );
        }
        history = Prompt.concat(
          history,
          Prompt.fromMessages([
            Prompt.makeMessage("tool", { content: results }),
          ])
        );
        yield* self.saveHistory(history);
        yield* self.append(turn, "tool_results", {
          results: results.map((part) => part.result),
          step,
        });
      }
      yield* self.append(turn, "step_cap", { steps: STEPS });
    });
  }

  // Runs or resumes the current turn in a fiber that outlives the request that started it.
  startFiber(turn: number) {
    const self = this;
    const startedAt = Number(
      this.ctx.storage.kv.get("startedAt") ?? Date.now()
    );
    const remaining = Math.max(0, TURN_MS - (Date.now() - startedAt));
    const tick = Effect.sync(() =>
      this.broadcast({ seq: -1, turn, type: "tick" })
    ).pipe(Effect.delay("15 seconds"), Effect.forever);
    const finish = (type: string, data: unknown = {}) =>
      Effect.gen(function* () {
        // A stopped tool round leaves tool calls without results; close them, or the next turn would rerun them (and
        // Anthropic rejects a tool_use without its tool_result).
        const history = yield* self.history();
        const last = history.content.at(-1);
        const open =
          last?.role === "assistant"
            ? last.content.filter((part) => part.type === "tool-call")
            : [];
        if (open.length > 0) {
          const results = open.map((call) =>
            Prompt.makePart("tool-result", {
              id: call.id,
              isFailure: true,
              name: call.name,
              providerExecuted: false,
              result: "Stopped by the Creator.",
            })
          );
          yield* self.saveHistory(
            Prompt.concat(
              history,
              Prompt.fromMessages([
                Prompt.makeMessage("tool", { content: results }),
              ])
            )
          );
        }
        yield* self.set("turn_running", undefined);
        yield* self.set("step", undefined);
        yield* self.append(turn, type, data);
      });
    const program = Effect.gen(function* () {
      yield* Effect.forkChild(tick);
      yield* self.turnLoop(turn).pipe(Effect.timeout(remaining));
    }).pipe(
      // onExit, not matchCauseEffect: an interrupted fiber skips match handlers but always runs its exit finalizer.
      Effect.onExit((exit) =>
        Exit.isSuccess(exit)
          ? finish("turn_done")
          : Cause.hasInterruptsOnly(exit.cause)
            ? finish("turn_failed", { reason: "stopped" })
            : finish("turn_failed", {
                reason: Cause.pretty(exit.cause).slice(0, 300),
              })
      ),
      Effect.ensuring(Effect.sync(() => (self.fiber = undefined)))
    );
    this.fiber = this.runtime.runFork(program);
    this.ctx.waitUntil(this.runtime.runPromise(Fiber.await(this.fiber)));
    void this.ctx.storage.setAlarm(Date.now() + 30_000);
  }

  // Heartbeat: while a turn is marked running, keep an alarm due; after an eviction it restarts the object and the turn.
  async alarm() {
    const running = await this.run(this.get("turn_running"));
    console.log(
      `[B ${this.instance}] alarm: running=${running} fiber=${Boolean(this.fiber)}`
    );
    if (!running) {
      return;
    }
    if (!this.fiber) {
      await this.run(
        this.append(Number(running), "turn_resumed", {
          instance: this.instance,
        })
      );
      this.startFiber(Number(running));
    }
    await this.ctx.storage.setAlarm(Date.now() + 30_000);
  }

  fetch(request: Request) {
    const self = this;
    const url = new URL(request.url);
    return this.run(
      Effect.gen(function* () {
        const action = url.pathname.split("/").at(-1);
        if (action === "ws") {
          return yield* self.openSocket(
            Number(url.searchParams.get("since") ?? 0)
          );
        }
        if (action === "stop") {
          if (self.fiber) {
            yield* Fiber.interrupt(self.fiber);
            return Response.json({ stopped: true });
          }
          return Response.json({ stopped: false });
        }
        if (action === "message") {
          const { model, text } = (yield* Effect.promise(() =>
            request.json()
          )) as { model?: ModelName; text: string };
          const running = yield* self.get("turn_running");
          if (running) {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`INSERT INTO inbox (text) VALUES (${text})`;
            yield* self.append(Number(running), "steer_queued", { text });
            return Response.json({ steer: true, turn: Number(running) });
          }
          const turn = Number((yield* self.get("turn")) ?? 0) + 1;
          yield* self.set("turn", String(turn));
          yield* self.set("turn_running", String(turn));
          yield* self.set("model", model ?? "sonnet");
          self.ctx.storage.kv.put("startedAt", Date.now());
          yield* self.saveHistory(
            Prompt.concat(yield* self.history(), Prompt.make(text))
          );
          yield* self.append(turn, "turn_started", {
            model: model ?? "sonnet",
            text,
          });
          self.startFiber(turn);
          return Response.json({ turn });
        }
        return new Response("not found", { status: 404 });
      })
    );
  }

  openSocket(since: number) {
    const self = this;
    return Effect.gen(function* () {
      const { 0: client, 1: server } = new WebSocketPair();
      self.ctx.acceptWebSocket(server);
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{
        seq: number;
        turn: number;
        type: string;
        data: string;
      }>`SELECT * FROM events WHERE seq > ${since} ORDER BY seq`;
      const running = yield* self.get("turn_running");
      server.send(
        JSON.stringify({
          data: { status: running ? "running" : "idle" },
          seq: -1,
          type: "state",
        })
      );
      for (const row of rows) {
        server.send(JSON.stringify({ ...row, data: JSON.parse(row.data) }));
      }
      console.log(
        `[B ${self.instance}] socket since=${since} replayed ${rows.length}`
      );
      return new Response(null, { status: 101, webSocket: client });
    });
  }

  webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code);
    } catch {}
  }
}

export default {
  fetch(request: Request, env: Env) {
    const draft = new URL(request.url).pathname.split("/")[2] ?? "proto";
    return env.TALKER.getByName(draft).fetch(request);
  },
};
