// The Maker (ADR 0006): one Durable Object per Draft, `env.MAKER.getByName(draftId)`, running one agent in a
// pi-durable Harness through PiHarness on the Agent class. The agent chats with the Creator and, when asked for a game
// or a change, loads the make-game skill and writes the game itself in the sandbox, with pi's coding tools, make-game's guides,
// `playtest`, and `build` (publish.ts), which checks the workspace and writes the next Revision. The sandbox is the Draft's Container, which the Maker
// starts and drives itself (agent-sandbox.ts).
//
// pi owns the run: the transcript, queued steers, model calls, and resuming after an eviction. Ours is the Effect
// services around pi and the sandbox, the requests the Worker forwards, and the sockets: every connect gets pi's
// snapshot of the conversation, then live batches (#128).
import { Type } from "@earendil-works/pi-ai";
import {
  createRegistry,
  defineExtension,
  defineTool,
  Harness,
  hook,
  InboxDoc,
  LiveDoc,
  ToolTask,
} from "@earendil-works/pi-durable";
import type {
  AgentEventStream,
  SubmissionId,
} from "@earendil-works/pi-durable";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { Agent } from "agents";
import type { Connection } from "agents";
import { PiHarness, skills } from "agents/harness/pi";
import { fromManifest, parseSkillMarkdown } from "agents/skills";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import {
  Cause,
  Context,
  Data,
  Effect,
  Layer,
  ManagedRuntime,
  Semaphore,
} from "effect";

import MUSIC_SF2 from "../../maker/agent-home/.agents/skills/make-game/references/music-sf2.md";
import MUSIC_SYNTH from "../../maker/agent-home/.agents/skills/make-game/references/music-synth.md";
import PHASER from "../../maker/agent-home/.agents/skills/make-game/references/phaser.md";
import R3F from "../../maker/agent-home/.agents/skills/make-game/references/r3f.md";
import REACT from "../../maker/agent-home/.agents/skills/make-game/references/react.md";
import SOUND_EFFECTS from "../../maker/agent-home/.agents/skills/make-game/references/sound-effects.md";
import MAKE_GAME from "../../maker/agent-home/.agents/skills/make-game/SKILL.md";
import {
  boxPlaytest,
  DEADLINE_MS,
  MAX_BUILDS,
  MAX_STEPS,
  restore,
  screenshots,
} from "../../maker/src/job.ts";
import MAKER from "../prompts/maker.md";
import { ADVISOR_PROVIDER, askAdvisor } from "./advisor.ts";
import {
  AgentSandbox,
  BoxStartFailed,
  boxEnv,
  containerBox,
  jobBox,
  readyFirst,
} from "./agent-sandbox.ts";
import { metered, piModels } from "./pi-models.ts";
import { BUSY, MAKER_VALUES, renderPrompt, USED_UP } from "./prompts.ts";
import { publishTool, revisionSource, writeAsked } from "./publish.ts";
import { creatorView } from "./reply.ts";
import { drafts, now } from "./schema.ts";
import { allowanceLeft } from "./storage.ts";
import { toolResult } from "./tool-results.ts";

class PiError extends Data.TaggedError("PiError")<{
  readonly cause: unknown;
}> {}

const call = <A>(f: () => Promise<A>) =>
  Effect.tryPromise({ catch: (cause) => new PiError({ cause }), try: f });

// The conversation at the edge: every call is a promise, so each method is one Effect.tryPromise.
class Pi extends Context.Service<
  Pi,
  {
    // A message while a turn runs joins it as a steer, after the current tool round.
    readonly send: (text: string) => Effect.Effect<string, PiError>;
    readonly abort: Effect.Effect<boolean, PiError>;
    readonly events: Effect.Effect<AgentEventStream, PiError>;
  }
>()("hopon/api/Pi") {}

const piLayer = (harness: PiHarness) => {
  const root = harness.session();
  return Layer.succeed(Pi, {
    abort: call(() => root.abort()),
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

// AI Gateway refuses a model call with 402 once its prepaid credits run out (ADR 0004), or under load with some left
// (apps/maker/eval/run.ts): the Maker is resting.
const OUT_OF_CREDITS = /Insufficient unified billing/u;

const TICK_MS = 15_000;
const TICKET_MS = 60_000;
// The app sends "ping" every 20 s (#126). A socket that died without closing stays in getWebSockets(), even across
// hibernation, so one with no ping for this long is closed.
const SILENT_MS = 60_000;

const PROMPT = renderPrompt(MAKER, MAKER_VALUES);

// The one skill, make-game (ADR 0008). Its guides (each engine, sound effects, music) are files beside its SKILL.md,
// which the agent reads with read_skill_resource, so every game starts from make-game's own rules.
const GUIDES = {
  "references/music-sf2.md": MUSIC_SF2,
  "references/music-synth.md": MUSIC_SYNTH,
  "references/phaser.md": PHASER,
  "references/r3f.md": R3F,
  "references/react.md": REACT,
  "references/sound-effects.md": SOUND_EFFECTS,
};
const makeGame = parseSkillMarkdown(MAKE_GAME);
if (!makeGame) {
  throw new Error("make-game's SKILL.md has no frontmatter");
}
const SKILLS = fromManifest({
  fingerprint: "v12",
  id: "hopon-maker",
  skills: [
    {
      body: makeGame.body,
      description: makeGame.description,
      name: makeGame.name,
      resources: Object.entries(GUIDES).map(([path, content]) => ({
        content,
        kind: "reference" as const,
        path,
      })),
    },
  ],
});

const Input = Type.Object({
  at: Type.Number({ description: "ms after the start tap" }),
  dx: Type.Optional(Type.Number({ description: "swipe distance, CSS px" })),
  dy: Type.Optional(Type.Number({ description: "swipe distance, CSS px" })),
  type: Type.Union([Type.Literal("tap"), Type.Literal("swipe")]),
  x: Type.Number(),
  y: Type.Number(),
});

// The limits of the run in flight, in the object's storage, keyed by the input that began pi's run (a turn's steers
// join it). Each run's work begins at its first tool call.
interface RunState {
  run: string;
  deadlineAt: number;
  // Tool calls but `build`, and `build` calls.
  steps: number;
  builds: number;
  // The box started again mid-run, from the current Revision, and the agent hasn't yet been told.
  restarted?: boolean;
  // Where the run's messages begin in `asked`.
  from: number;
  // How many of the Creator's messages the agent had seen when the run's last `build` began: not those still queued.
  seen?: number;
  // The Revision the run last published. It outlives a limit that stops the run, as an old Draft's port published
  // before its change does, so the refusal tells the Creator to send the rest again.
  published?: number;
}

const PROVIDER = "anthropic";
// Tools that change the workspace, after which it no longer holds the Revision it was restored to.
const WRITES = new Set(["bash", "edit", "write"]);

export class Maker extends Agent<Env> {
  // Overridden by the Maker test's fake sandbox (test/maker/worker.ts).
  sandboxLayer() {
    return containerBox(this.ctx.container);
  }

  sandbox = ManagedRuntime.make(this.sandboxLayer());
  // One start at a time: a call that finds the box starting waits for it, restore included.
  starting = Semaphore.makeUnsafe(1);

  // The box is a cache over the Draft's current Revision: one that stopped (idle, a deploy, a crash) starts again
  // from it, and a run in flight is told its work is gone.
  up = this.starting.withPermit(
    Effect.gen({ self: this }, function* () {
      const box = yield* AgentSandbox;
      if (yield* box.running) {
        return;
      }
      // Delete destroyed the box; nothing starts another.
      if (this.closing) {
        return yield* new BoxStartFailed({ cause: "the Draft is deleted" });
      }
      yield* box.start;
      const { n, source } = yield* Effect.promise(() =>
        revisionSource(this.env.FILES, this.name)
      );
      yield* Effect.promise(async () => {
        await restore(jobBox(box), source);
        await writeAsked(jobBox(box), this.askedSinceNew());
      });
      this.workspace = n;
      const state = this.runState;
      if (state) {
        this.runState = { ...state, restarted: true };
      }
    })
  );

  // Every command and file a run touches comes through `up` first.
  box = readyFirst(this.sandbox.runSync(AgentSandbox), () =>
    this.sandbox.runPromise(this.up)
  );

  // One run begins at a time: a round's parallel first calls restore the workspace once.
  beginning = Semaphore.makeUnsafe(1);
  // The run's abort timer, 30 s past its deadline (MAKER_BUILD_ABORT_S), cleared at its end.
  abortTimer: ReturnType<typeof setTimeout> | undefined;
  // Set by Delete: from then on nothing starts the box or reopens pi.
  closing = false;

  get runState() {
    return this.ctx.storage.kv.get<RunState>("run");
  }

  set runState(state: RunState | undefined) {
    this.ctx.storage.kv.put("run", state);
  }

  // Whether the box restarted since the agent was last told, which it is now.
  tellRestart() {
    const state = this.runState;
    if (!state?.restarted) {
      return false;
    }
    this.runState = { ...state, restarted: false };
    return true;
  }

  // Everything the Creator has said in this chat.
  get asked() {
    return this.ctx.storage.kv.get<string[]>("asked") ?? [];
  }

  set asked(messages: string[]) {
    this.ctx.storage.kv.put("asked", messages);
  }

  // What verify.js reads for its `Music: none` quote (publish.ts's writeAsked): what the Creator asked of an earlier
  // game doesn't hold for the next one. A published new game (a start over is one) cuts at the messages its agent had
  // seen when it built, so one sent during the build counts for the change after it; the run in flight keeps its own.
  askedSinceNew(run = this.runState) {
    const cut = this.ctx.storage.kv.get<number>("askedFrom") ?? 0;
    return this.asked.slice(Math.min(cut, run?.from ?? cut));
  }

  // The Revision the workspace holds, undefined once a run has changed it.
  get workspace() {
    return this.ctx.storage.kv.get<number>("workspace");
  }

  set workspace(n: number | undefined) {
    if (n === undefined) {
      this.ctx.storage.kv.delete("workspace");
    } else {
      this.ctx.storage.kv.put("workspace", n);
    }
  }

  // A run's work begins: the Allowance checked (ADR 0004: work starts only above zero; once started it finishes), the
  // box up, and the workspace restored to the current Revision unless it holds it. Undefined, or why it can't begin.
  // Each later call of the run brings the box up too, so one that stopped since is restarted, and the run told, before
  // the call runs on what's left.
  // Whether the Draft's owner has any Allowance left.
  async allowed() {
    const db = drizzle(this.env.DB);
    const draft = await db
      .select({ owner: drafts.owner })
      .from(drafts)
      .where(eq(drafts.id, this.name))
      .get();
    return (
      !!draft &&
      (await allowanceLeft(
        db,
        draft.owner,
        Number(this.env.MAKER_WEEKLY_TOKENS)
      )) > 0
    );
  }

  async begin(run: string, from: number): Promise<string | undefined> {
    const begun = this.runState?.run === run;
    if (!begun && !(await this.allowed())) {
      return toolResult("used-up", { USED_UP });
    }
    const up = await this.sandbox.runPromise(
      this.up.pipe(
        Effect.as(true),
        // NoBox's message says how to get a box under plain `wrangler dev`.
        Effect.catch((error) =>
          Effect.sync(() => {
            console.error(`Maker ${this.name}: no box`, error);
            return false;
          })
        )
      )
    );
    if (!up) {
      return toolResult("busy", { BUSY });
    }
    if (begun) {
      return;
    }
    const { n, source } = await revisionSource(this.env.FILES, this.name);
    if (this.workspace !== n) {
      await restore(jobBox(this.box), source);
      this.workspace = n;
    }
    const state = {
      builds: 0,
      deadlineAt: Date.now() + DEADLINE_MS,
      from,
      run,
      steps: 0,
    };
    await writeAsked(jobBox(this.box), this.askedSinceNew(state));
    this.runState = state;
    clearTimeout(this.abortTimer);
    this.abortTimer = setTimeout(
      () => {
        if (this.runState?.run === run && !this.closing) {
          this.runtime.runFork(Pi.use((pi) => pi.abort));
        }
      },
      Number(this.env.MAKER_BUILD_ABORT_S) * 1000
    );
  }

  playtest = defineTool({
    description:
      "Typecheck and play the game in headless Chromium (360×640) on a fake clock: loads it, taps the centre to start, runs your inputs (game ms), stops when the game ends, and returns the result with screenshots of the start and the end (the over screen when it ended).",
    execute: async ({ inputs }, _api, context) => {
      // Stop and the abort timer abort the run, and with it the playtest's command.
      const box = jobBox(this.box, context?.abortSignal);
      const result = await boxPlaytest(
        box,
        JSON.stringify({ inputs: inputs ?? [] })
      );
      const images = result.typeErrors.length > 0 ? [] : await screenshots(box);
      return {
        output: [
          { text: JSON.stringify(result), type: "text" as const },
          ...images,
        ],
      };
    },
    executionMode: "sequential",
    name: "playtest",
    parameters: Type.Object({
      inputs: Type.Optional(
        Type.Array(Input, {
          description:
            "Taps and swipes for your game's controls, in CSS px; 3 s of play when empty",
        })
      ),
    }),
    // It plays the workspace as it is and writes only its own screenshots, so running it twice is harmless.
    replay: "safe",
  });

  build = publishTool(
    this.env,
    this.name,
    (signal) => jobBox(this.box, signal),
    () => this.askedSinceNew(),
    () => this.tellRestart(),
    (n, kind) => {
      this.workspace = n;
      const state = this.runState;
      if (state) {
        this.runState = { ...state, published: n };
      }
      if (kind === "new") {
        this.ctx.storage.kv.put(
          "askedFrom",
          this.runState?.seen ?? this.asked.length
        );
      }
    }
  );

  // #116's limits, per run: the 21st step, the 5th `build` and any call past the deadline are refused, and the agent
  // tells the Creator. The run's first call begins its work.
  limits = hook(ToolTask, {
    beforeTool: async (toolCall, api, context) => {
      if (toolCall.parent) {
        return;
      }
      const live = await api.snapshot(LiveDoc, api.conversationId, context);
      const inputs = live?.run?.inputs ?? [];
      const run = String(inputs[0]);
      const inbox = await api.snapshot(InboxDoc, api.conversationId, context);
      const seen =
        this.asked.length -
        (inbox?.items ?? []).filter((item) => item.mode !== "write").length;
      const refused = await this.sandbox.runPromise(
        this.beginning.withPermit(
          Effect.promise(() => this.begin(run, seen - inputs.length))
        )
      );
      const state = this.runState;
      if (refused || state?.run !== run) {
        return { block: refused ?? toolResult("run-ended") };
      }
      if (this.tellRestart()) {
        return { block: toolResult("restarted") };
      }
      const building = toolCall.name === "build";
      const next = {
        ...state,
        builds: state.builds + (building ? 1 : 0),
        ...(building && { seen }),
        steps: state.steps + (building ? 0 : 1),
      };
      this.runState = next;
      const GIVE_UP =
        state.published === undefined
          ? toolResult("give-up")
          : toolResult("kept", { N: state.published });
      if (next.steps > MAX_STEPS) {
        return { block: toolResult("steps", { GIVE_UP, MAX_STEPS }) };
      }
      if (next.builds > MAX_BUILDS) {
        return { block: toolResult("builds", { GIVE_UP, MAX_BUILDS }) };
      }
      if (Date.now() > state.deadlineAt) {
        return {
          block: toolResult("deadline", {
            GIVE_UP,
            SECONDS: DEADLINE_MS / 1000,
          }),
        };
      }
      if (WRITES.has(toolCall.name)) {
        this.workspace = undefined;
      }
    },
  });

  advisor = askAdvisor(
    this.env,
    () => this.name,
    () => this.allowed(),
    () => this.harness.pi()
  );

  maker = defineExtension({
    hooks: [this.limits, metered(this.env, () => this.name)],
    name: "maker",
    sections: [{ key: "preamble", render: () => PROMPT, tag: false }],
    tools: [this.playtest, this.build, this.advisor],
  });

  harness = new PiHarness({
    defaults: {
      model: { id: this.env.MAKER_MODEL, provider: PROVIDER },
      thinkingLevel: this.env.MAKER_EFFORT,
    },
    harness: async ({ storage, context, onWake }) => {
      const skilled = await skills([SKILLS]);
      const metadata = () => ({ agent: "maker" as const, draftId: this.name });
      const registry = createRegistry();
      for (const extension of [CodingTools, this.maker, skilled]) {
        registry.install(extension);
      }
      // Retention 0: pi drops an idle conversation at once, so the object hibernates between turns (#128). onWake: a
      // sleeping task (a retry backoff) wakes the object by its alarm, not an in-memory timer, so it hibernates then too.
      return Harness.open(
        storage,
        {
          env: () => boxEnv(this.box, `box:${this.name}`),
          models: piModels(this.env, [
            { metadata, model: this.env.MAKER_MODEL, provider: PROVIDER },
            {
              metadata,
              model: this.env.MAKER_ADVISOR_MODEL,
              provider: ADVISOR_PROVIDER,
            },
          ]),
          onWake,
          registry,
          settings: {
            contextRetentionMs: 0,
            documentRetentionMs: 0,
            extensions: [CodingTools, this.maker, skilled],
          },
        },
        context
      );
    },
  });

  runtime = ManagedRuntime.make(piLayer(this.harness));
  // pi's event streams live in memory, one per socket, so a wake re-attaches every held socket (onStart).
  streams = new Map<string, AgentEventStream>();
  // The object's own stream, which runs the ticker during each run and dates the D1 row at its end.
  watcher: AgentEventStream | undefined;
  ticker: ReturnType<typeof setInterval> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.lifecycle.use(this.harness);
    // Answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong")
    );
    // A box that outlived the object (a crash, an eviction, a deploy) lost its inactivity timeout with it.
    // oxlint-disable-next-line no-void -- blockConcurrencyWhile holds every event until it settles
    void ctx.blockConcurrencyWhile(() =>
      this.sandbox.runPromise(
        Effect.gen(function* () {
          const box = yield* AgentSandbox;
          if (yield* box.running) {
            yield* box.keepAlive;
          }
        }).pipe(
          // Thrown here, it would reset the object, failing every request it holds.
          Effect.catchCause((cause) =>
            Effect.sync(() =>
              console.error(
                `Maker ${this.name}: no inactivity timeout`,
                Cause.pretty(cause)
              )
            )
          )
        )
      )
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
      const forCreator = creatorView();
      send({
        data: forCreator(stream.snapshot) as typeof stream.snapshot,
        type: "snapshot",
      });
      stream.start((events) => {
        send({ data: events.map(forCreator), type: "batch" });
        for (const event of events) {
          if (event.type !== "submission") {
            continue;
          }
          const { id, status } = event.record;
          if (status === "done") {
            send({ id, type: "turn_done" });
          } else if (status === "unanswered") {
            const { detail, reason } = event.record;
            send({
              id,
              reason: OUT_OF_CREDITS.test(JSON.stringify(detail))
                ? "resting"
                : reason,
              type: "turn_failed",
            });
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
    // A run Lifecycle resumed after an eviction started before this stream did.
    if (this.watcher.snapshot.run) {
      this.tick();
    }
    this.watcher.start(async (events) => {
      for (const event of events) {
        if (event.type === "run_start") {
          this.tick();
        } else if (event.type === "run_end") {
          clearInterval(this.ticker);
          this.ticker = undefined;
          clearTimeout(this.abortTimer);
          // oxlint-disable-next-line no-await-in-loop -- one run ends per batch at most.
          await db
            .update(drafts)
            .set({ updatedAt: now })
            .where(eq(drafts.id, this.name));
        }
      }
    });
  }

  // From a run's start to its end (watch), every socket hears something at least every 15 s, and dead ones are closed.
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

  // After hibernation or an eviction the sockets are still held but their streams are gone.
  async onStart() {
    await this.watch();
    for (const connection of this.getConnections<{ since: number }>()) {
      // oxlint-disable-next-line no-await-in-loop -- one snapshot at a time is fine for a handful of sockets.
      await this.runtime.runPromise(this.attach(connection));
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
    const expires = tickets.get(ticket);
    if (expires === undefined) {
      return false;
    }
    tickets.delete(ticket);
    await this.ctx.storage.put("tickets", tickets);
    return expires > Date.now();
  }

  // The Worker's forwarded requests, after it has checked the owner and screened the text.
  onRequest(request: Request) {
    const action = new URL(request.url).pathname.slice(1);
    return this.runtime.runPromise(
      Effect.gen({ self: this }, function* () {
        const pi = yield* Pi;
        if (action === "message") {
          const { text: message } = yield* Effect.promise(() =>
            request.json<{ text: string }>()
          );
          const id = yield* pi.send(message);
          // After pi queues it, so a message counted here is in pi's inbox or a run (the limits hook's `seen`).
          this.asked = [...this.asked, message];
          return Response.json({ id }, { status: 202 });
        }
        if (action === "stop") {
          yield* pi.abort;
          return new Response(null, { status: 204 });
        }
        // Publish (#145) waits for a turn to end: one running, or a message queued for the next.
        if (action === "busy") {
          const stream = yield* pi.events;
          yield* Effect.promise(() => stream.stop());
          const { snapshot } = stream;
          return Response.json({
            busy: !!snapshot.run || snapshot.inbox.length > 0,
          });
        }
        // Delete (#144): any run stopped, the box, then the transcripts, the schedules and the rest of the storage; the
        // reset closes the sockets. The Worker deletes the files and the row.
        if (action === "delete") {
          // A running build ends first, while pi is open; after `closing` nothing reaches pi or starts the box.
          yield* pi.abort;
          this.closing = true;
          yield* Effect.promise(() =>
            this.sandbox.runPromise(
              Effect.gen(function* () {
                const box = yield* AgentSandbox;
                if (yield* box.running) {
                  yield* box.destroy;
                }
              })
            )
          );
          yield* Effect.promise(() => this.destroy());
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
