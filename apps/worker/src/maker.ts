// The Maker (ADR 0005): one Durable Object per Draft, `env.MAKER.getByName(draftId)`, running both of the Draft's
// agents in one pi-durable Harness through PiHarness on the Agent class. The main agent is the root conversation: it
// chats with the Creator and calls `build` (build.ts). The sub agent is a child conversation each `build` call owns: it
// writes the game in the sandbox with pi's coding tools and `playtest`. The sandbox is the Draft's Container, which the
// Maker starts and drives itself (agent-sandbox.ts).
//
// pi owns the run: the transcripts, queued steers, model calls, and resuming after an eviction. Ours is the Effect
// services around pi and the sandbox, the requests the Worker forwards, and the sockets: every connect gets pi's
// snapshot of the main agent's conversation, then live batches (#128). What a job does in the sandbox (the prompt, the
// playtest, the workspace it starts from, its ending) is the game rules' (apps/maker/src/job.ts).
import { Type } from "@earendil-works/pi-ai";
import {
  createRegistry,
  defineExtension,
  defineTool,
  GenerationTask,
  Harness,
  hook,
  ToolTask,
} from "@earendil-works/pi-durable";
import type {
  AgentEventStream,
  ConversationId,
  Extension,
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

import BUILDING_GAMES from "../../maker/agent-home/.agents/skills/building-games/SKILL.md";
import DOM_GAMES from "../../maker/agent-home/.agents/skills/dom-games/SKILL.md";
import LITTLEJS from "../../maker/agent-home/.agents/skills/littlejs-api/SKILL.md";
import MUSIC_SYNTH from "../../maker/agent-home/.agents/skills/music-synth/SKILL.md";
import ZZFX from "../../maker/agent-home/.agents/skills/zzfx/SKILL.md";
import AGENTS from "../../maker/agent-home/AGENTS.md";
import {
  boxPlaytest,
  checkBuild,
  DEADLINE_MS,
  MAX_REPAIRS,
  MAX_STEPS,
  pastDeadline,
  prompt,
  repairPrompt,
  RESTARTED,
  restore,
  screenshots,
  stepLabel,
  SYSTEM_PROMPT,
} from "../../maker/src/job.ts";
import type { Job } from "../../maker/src/job.ts";
import {
  AgentSandbox,
  BoxStartFailed,
  boxEnv,
  containerBox,
  jobBox,
  readyFirst,
} from "./agent-sandbox.ts";
import { buildTool } from "./build.ts";
import type { Final } from "./build.ts";
import { MAIN_PROMPT } from "./main-prompt.ts";
import { metered, piModels } from "./pi-models.ts";
import { drafts, now } from "./schema.ts";

class PiError extends Data.TaggedError("PiError")<{
  readonly cause: unknown;
}> {}

const call = <A>(f: () => Promise<A>) =>
  Effect.tryPromise({ catch: (cause) => new PiError({ cause }), try: f });

// The main agent's conversation at the edge: every call is a promise, so each method is one Effect.tryPromise.
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

// AGENTS.md as the sub agent's project section, with its "read the skill" lines pointed at activate_skill: the skills
// aren't files.
const READ_SKILL =
  "Read the `building-games` skill, then the skill for the engine, with the **read tool**. Skills are not in the workspace, so bash can't see them; don't look for them with bash";
if (!AGENTS.includes(READ_SKILL)) {
  throw new Error("AGENTS.md no longer says how to read a skill");
}
const PROJECT = AGENTS.replace(
  READ_SKILL,
  "Load the `building-games` skill, then the skill for the engine, with **activate_skill**. Skills are not in the workspace, so bash can't see them; don't look for them with bash"
)
  .replaceAll("Read the `", "Load the `")
  .replaceAll("read the `", "load the `");

const SKILLS = fromManifest({
  fingerprint: "v2",
  id: "hopon-coder",
  skills: [BUILDING_GAMES, DOM_GAMES, LITTLEJS, MUSIC_SYNTH, ZZFX].map(
    (raw) => {
      const parsed = parseSkillMarkdown(raw);
      if (!parsed) {
        throw new Error(`a SKILL.md without frontmatter: ${raw.slice(0, 80)}`);
      }
      const { body, description, name } = parsed;
      return { body, description, name };
    }
  ),
});

const Input = Type.Object({
  at: Type.Number({ description: "ms after the start tap" }),
  dx: Type.Optional(Type.Number({ description: "swipe distance, CSS px" })),
  dy: Type.Optional(Type.Number({ description: "swipe distance, CSS px" })),
  type: Type.Union([Type.Literal("tap"), Type.Literal("swipe")]),
  x: Type.Number(),
  y: Type.Number(),
});

// The running or last job, in the object's storage, so a restarted object still knows its limits.
interface JobState {
  jobId: string;
  job: Job;
  // The sub agent's conversation, as PiHarness names its session.
  conversation: string;
  deadlineAt: number;
  steps: number;
  // The harness check's failures sent back to the sub agent.
  repairs: number;
  // The last playtest's argument, which the harness check plays again.
  played?: string;
  // The box started again mid-job and lost what the sub agent wrote, which it hasn't yet been told.
  restarted?: boolean;
  // Why it was stopped: the deadline, the step limit or Stop.
  stopped?: string;
}

// Each agent's model calls go through its own pi provider, which tags them for the gateway (pi-models.ts). The eval
// reads the tags.
const MAIN_PROVIDER = "anthropic";
const SUB_PROVIDER = "anthropic-sub";

const text = (content: readonly { type: string; text?: string }[]) =>
  content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");

export class Maker extends Agent<Env> {
  // Overridden by the Maker test's fake sandbox (test/maker/worker.ts).
  sandboxLayer() {
    return containerBox(this.ctx.container);
  }

  sandbox = ManagedRuntime.make(this.sandboxLayer());
  // One start at a time: a call that finds the box starting waits for it, restore included.
  starting = Semaphore.makeUnsafe(1);

  // The box is a cache over the job: one that stopped (idle, a deploy, a crash) starts again from the unfinished
  // job's source, whether pi resumes the run with nobody connected or a rerun of `build` waits for it. What the old box
  // held since the job began is gone, and the harness check, which would otherwise pass the old game, first tells the
  // sub agent to write its changes again.
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
      const state = this.job;
      if (state && !this.final(state.jobId)) {
        yield* Effect.promise(() => restore(jobBox(box), state.job.source));
        this.job = { ...state, restarted: true };
      }
    })
  );

  // Every command and file a job touches comes through `up` first.
  box = readyFirst(this.sandbox.runSync(AgentSandbox), () =>
    this.sandbox.runPromise(this.up)
  );

  // What each job holds in memory while its `build` call waits: its step listener, its deadline, and the abort of the
  // harness check's commands. Keyed by job, so a stopped job that is still ending never touches the next one.
  running = new Map<
    string,
    {
      step: (label: string) => void;
      deadline: ReturnType<typeof setTimeout>;
      check: AbortController;
    }
  >();
  // One job begins at a time, so a stopped job still restoring the workspace can't overwrite the next one's.
  beginning = Semaphore.makeUnsafe(1);
  // Set by Delete: from then on nothing starts the box or reopens pi.
  closing = false;

  get job() {
    return this.ctx.storage.kv.get<JobState>("job");
  }

  set job(state: JobState | undefined) {
    this.ctx.storage.kv.put("job", state);
  }

  // The last job's final event only: one with music.js runs to hundreds of KB.
  final(jobId: string) {
    const last = this.ctx.storage.kv.get<{ jobId: string; event: Final }>(
      "final"
    );
    return last?.jobId === jobId ? last.event : undefined;
  }

  // Stops this job only, and never after Delete, when reaching pi would open it again.
  stop(jobId: string, reason: string) {
    const { job } = this;
    if (this.closing || job?.jobId !== jobId || this.final(jobId)) {
      return;
    }
    this.job = { ...job, stopped: job.stopped ?? reason };
    this.running.get(jobId)?.check.abort();
    // oxlint-disable-next-line no-void -- the run ends on its own; its waiter reads `stopped`
    void this.harness.session(job.conversation).abort();
  }

  settle(jobId: string, event: Final) {
    this.ctx.storage.kv.put("final", { event, jobId });
    return event;
  }

  // The sub agent's answer, through the harness check (job.ts): a message that sends it back to work, or the job's
  // final event, kept for a rerun of `build`. A job stopped meanwhile is left to `runJob`.
  async end(jobId: string, report: string) {
    await this.sandbox.runPromise(this.up);
    const before = this.job;
    if (before?.jobId !== jobId) {
      throw new Error(`job ${jobId} ended without its state`);
    }
    const verdict = await checkBuild(
      jobBox(this.box, this.running.get(jobId)?.check.signal),
      { inputs: before.played, job: before.job }
    );
    const state = this.job;
    if (state?.jobId !== jobId || state.stopped) {
      return;
    }
    if (state.restarted) {
      this.job = { ...state, restarted: false };
      return { continue: RESTARTED };
    }
    // The tests spike's record of each failed check and each test error, which the eval reads from the step labels.
    const { testErrors = [], ...outcome } = verdict;
    if (testErrors.length > 0) {
      this.running
        .get(jobId)
        ?.step(`Test error: ${testErrors.join(" | ").slice(0, 600)}`);
    }
    if ("errors" in outcome) {
      this.running
        .get(jobId)
        ?.step(`Harness failed: ${outcome.errors.join(" | ").slice(0, 600)}`);
      if (state.repairs < MAX_REPAIRS) {
        this.job = { ...state, repairs: state.repairs + 1 };
        return { continue: repairPrompt(outcome.errors) };
      }
      this.settle(jobId, {
        reason: `the harness check failed: ${outcome.errors.join("; ")}`,
        type: "failed",
      });
      return;
    }
    this.settle(
      jobId,
      Date.now() > state.deadlineAt
        ? { reason: pastDeadline(DEADLINE_MS / 1000), type: "failed" }
        : { ...outcome, summary: report.trim(), type: "done" }
    );
  }

  playtest = defineTool({
    description:
      "Typecheck and play the game in headless Chromium (360×640): loads it, taps the centre to start, runs your inputs, and returns the result with screenshots of the start and the end.",
    execute: async ({ inputs }, _api, context) => {
      // Stop and the deadline abort the run, and with it the playtest's command.
      const box = jobBox(this.box, context?.abortSignal);
      const played = JSON.stringify({ inputs: inputs ?? [] });
      const result = await boxPlaytest(box, played);
      const { job } = this;
      if (job) {
        this.job = { ...job, played };
      }
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

  // #116's step limit: the 21st call is blocked and the job stopped. Each step's label goes to the main agent's status.
  limits = hook(ToolTask, {
    beforeTool: (toolCall) => {
      const { job } = this;
      if (!job || toolCall.parent) {
        return;
      }
      const steps = job.steps + 1;
      this.job = { ...job, steps };
      if (steps > MAX_STEPS) {
        this.stop(job.jobId, `over ${MAX_STEPS} steps`);
        return { block: `Over the ${MAX_STEPS}-step limit.` };
      }
      this.running
        .get(job.jobId)
        ?.step(stepLabel(toolCall.name, toolCall.arguments));
    },
  });

  // The ending runs inside pi's run, at each of the sub agent's final answers, so it completes with nobody connected.
  // A `continue` sends the sub agent back to work in the same run. A stopped run never yields; `runJob` ends it.
  ending = hook(GenerationTask, {
    onYield: async (answer) => {
      const state = this.job;
      if (!state || state.stopped || this.final(state.jobId)) {
        return;
      }
      return await this.end(state.jobId, text(answer.content));
    },
  });

  // Each agent is one extension, so its prompt and hooks apply to its own conversations only. The sub agent's skills
  // come from skills(), which is async, so the Harness factory adds them.
  sub = defineExtension({
    hooks: [this.limits, this.ending, metered(this.env, () => this.name)],
    name: "sub",
    sections: [
      { key: "preamble", render: () => SYSTEM_PROMPT, tag: false },
      { key: "project", render: () => PROJECT },
    ],
    tools: [this.playtest],
  });

  subSkills: Extension | undefined;

  main = defineExtension({
    hooks: [metered(this.env, () => this.name)],
    name: "main",
    sections: [{ key: "preamble", render: () => MAIN_PROMPT, tag: false }],
    tools: [
      buildTool(
        this.env,
        this.name,
        this.ctx.storage,
        () => {
          this.runtime.runFork(Pi.use((pi) => pi.abort));
        },
        {
          agent: () => ({
            extensions: [
              CodingTools,
              this.sub,
              ...(this.subSkills ? [this.subSkills] : []),
            ],
            model: {
              modelId: this.env.MAKER_SUB_MODEL,
              provider: SUB_PROVIDER,
            },
            thinkingLevel: this.env.MAKER_SUB_EFFORT,
          }),
          run: (job, step, signal) => this.runJob(job, step, signal),
        }
      ),
    ],
  });

  harness = new PiHarness({
    defaults: {
      model: { id: this.env.MAKER_MAIN_MODEL, provider: MAIN_PROVIDER },
      thinkingLevel: this.env.MAKER_MAIN_EFFORT,
    },
    harness: async ({ storage, context, onWake }) => {
      this.subSkills = await skills([SKILLS]);
      const registry = createRegistry();
      for (const extension of [
        CodingTools,
        this.sub,
        this.subSkills,
        this.main,
      ]) {
        registry.install(extension);
      }
      // Retention 0: pi drops an idle conversation at once, so the object hibernates between turns (#128). onWake: a
      // sleeping task (a retry backoff) wakes the object by its alarm, not an in-memory timer, so it hibernates then too.
      return Harness.open(
        storage,
        {
          env: () => boxEnv(this.box, `box:${this.name}`),
          models: piModels(this.env, [
            {
              metadata: () => ({ agent: "talker", draftId: this.name }),
              model: this.env.MAKER_MAIN_MODEL,
              provider: MAIN_PROVIDER,
            },
            {
              metadata: () => ({
                agent: "coder",
                draftId: this.name,
                jobId: this.job?.jobId ?? "none",
              }),
              model: this.env.MAKER_SUB_MODEL,
              provider: SUB_PROVIDER,
            },
          ]),
          onWake,
          registry,
          // The root conversation, the main agent's, gets only its own extension. `build` configures each child.
          settings: {
            contextRetentionMs: 0,
            documentRetentionMs: 0,
            extensions: [this.main],
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

  // A job's deadline, armed when its `build` call waits for it, and again by a rerun after a restart.
  armDeadline(state: JobState) {
    return setTimeout(
      () => this.stop(state.jobId, pastDeadline(DEADLINE_MS / 1000)),
      Math.max(0, state.deadlineAt - Date.now())
    );
  }

  // A job's start, one at a time: the box up, and for a new job the workspace rewritten from its source and its state
  // written. Its prompt is submitted every time, under its id, so a rerun after a reset submits it if the reset came
  // first, and pi takes it once. Undefined once started; a final event when it can't start.
  async begin(
    jobId: string,
    job: Job,
    session: ReturnType<PiHarness["session"]>,
    signal: AbortSignal
  ): Promise<Final | undefined> {
    if (signal.aborted) {
      return this.settle(jobId, { reason: "cancelled", type: "failed" });
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
      // A box that can't start built nothing and made no model call: `busy` (#122).
      return this.settle(jobId, { reason: "busy", type: "failed" });
    }
    if (this.job?.jobId !== jobId) {
      await restore(jobBox(this.box), job.source);
      if (signal.aborted) {
        return this.settle(jobId, { reason: "cancelled", type: "failed" });
      }
      this.job = {
        conversation: session.id,
        deadlineAt: Date.now() + DEADLINE_MS,
        job,
        jobId,
        repairs: 0,
        steps: 0,
      };
    }
    await session.submit(prompt(job), { operationId: jobId });
  }

  // One job, from `build`: started, then waited for; a finished one is answered at once. Stop and the turn's timer
  // abort `signal`, and the job ends `failed: cancelled`.
  async runJob(
    {
      jobId,
      job,
      conversation,
    }: { jobId: string; job: Job; conversation: ConversationId },
    step: (label: string) => void,
    signal: AbortSignal
  ): Promise<Final> {
    const stored = this.final(jobId);
    if (stored) {
      return stored;
    }
    const session = this.harness.session(String(conversation));
    const unstarted = await this.sandbox.runPromise(
      this.beginning.withPermit(
        Effect.promise(() => this.begin(jobId, job, session, signal))
      )
    );
    const state = this.job;
    if (unstarted || state?.jobId !== jobId) {
      return (
        unstarted ??
        this.final(jobId) ?? { reason: "cancelled", type: "failed" }
      );
    }
    const cancel = () => this.stop(jobId, "cancelled");
    signal.addEventListener("abort", cancel, { once: true });
    const deadline = this.armDeadline(state);
    this.running.set(jobId, { check: new AbortController(), deadline, step });
    try {
      await session.wait(jobId);
      // The run's last answer settled it (`end`), unless it was stopped or the check threw, which pi swallows.
      return (
        this.final(jobId) ??
        this.settle(jobId, {
          reason: this.job?.stopped ?? "the harness check didn't finish",
          type: "failed",
        })
      );
    } catch (error) {
      console.error(`Maker ${this.name}: job ${jobId}`, error);
      return this.settle(jobId, {
        reason: `the sub agent failed: ${String(error)}`,
        type: "failed",
      });
    } finally {
      clearTimeout(deadline);
      signal.removeEventListener("abort", cancel);
      this.running.delete(jobId);
    }
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
        // Delete (#144): any build stopped, the box, then the transcripts, the schedules and the rest of the storage; the
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
