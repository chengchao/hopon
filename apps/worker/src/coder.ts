// The Coder (ADR 0003, #171): one SQLite Durable Object per Draft, `env.CODER.getByName(draftId)`, running pi-durable
// through PiHarness and Lifecycle, as the Talker does. Its box is a Container it drives itself (src/coder-box.ts). The
// Talker POSTs a job to /jobs/:jobId and reads NDJSON events back (talker-build.ts); the job id is the pi submission's
// operationId, so a re-POST attaches to the running job, and a finished job's final event is kept in storage.
//
// What the job does in the box (the prompt, the playtest, the workspace it starts from, its ending) is the game rules'
// (apps/maker/src/job.ts). pi's own CodingTools (read, write, edit, bash) run in the box, the skills come through
// agents' skills(), and playtest is a replay-safe tool.
import { Type } from "@earendil-works/pi-ai";
import {
  createRegistry,
  defineTool,
  GenerationTask,
  Harness,
  hook,
  ToolTask,
} from "@earendil-works/pi-durable";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { PiHarness, skills } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { fromManifest, parseSkillMarkdown } from "agents/skills";
import { DurableObject } from "cloudflare:workers";
import { Cause, Effect, ManagedRuntime, Schema, Semaphore } from "effect";

import DOM_GAMES from "../../maker/agent-home/.agents/skills/dom-games/SKILL.md";
import LITTLEJS from "../../maker/agent-home/.agents/skills/littlejs-api/SKILL.md";
import MUSIC_SYNTH from "../../maker/agent-home/.agents/skills/music-synth/SKILL.md";
import ZZFX from "../../maker/agent-home/.agents/skills/zzfx/SKILL.md";
import AGENTS from "../../maker/agent-home/AGENTS.md";
import {
  boxPlaytest,
  deadlineFor,
  finishJob,
  JobSchema,
  MAX_STEPS,
  pastDeadline,
  prompt,
  restore,
  screenshots,
  stepLabel,
  SYSTEM_PROMPT,
} from "../../maker/src/job.ts";
import type { CoderEvent, Job, PlaytestResult } from "../../maker/src/job.ts";
import { Box, boxEnv, containerBox, jobBox, readyFirst } from "./coder-box.ts";
import { piModels } from "./pi-models.ts";

const JOB_PATH = /^\/jobs\/(?<jobId>[^/]+)(?<cancel>\/cancel)?$/u;
const PING_MS = 10_000;

// AGENTS.md as the project section, with its "read the skill" lines pointed at activate_skill: the skills aren't files.
const READ_SKILL =
  "Read the skill for the engine with the **read tool**. Skills are not in the workspace, so bash can't see them; don't look for them with bash";
if (!AGENTS.includes(READ_SKILL)) {
  throw new Error("AGENTS.md no longer says how to read a skill");
}
const PROJECT = AGENTS.replace(
  READ_SKILL,
  "Load the skill for the engine with **activate_skill**. Skills are not in the workspace, so bash can't see them; don't look for them with bash"
)
  .replaceAll("Read the `", "Load the `")
  .replaceAll("read the `", "load the `");

const SKILLS = fromManifest({
  fingerprint: "v1",
  id: "hopon-coder",
  skills: [DOM_GAMES, LITTLEJS, MUSIC_SYNTH, ZZFX].map((raw) => {
    const parsed = parseSkillMarkdown(raw);
    if (!parsed) {
      throw new Error(`a SKILL.md without frontmatter: ${raw.slice(0, 80)}`);
    }
    const { body, description, name } = parsed;
    return { body, description, name };
  }),
});

const Input = Type.Object({
  at: Type.Number({ description: "ms after the start tap" }),
  dx: Type.Optional(Type.Number({ description: "swipe distance, CSS px" })),
  dy: Type.Optional(Type.Number({ description: "swipe distance, CSS px" })),
  type: Type.Union([Type.Literal("tap"), Type.Literal("swipe")]),
  x: Type.Number(),
  y: Type.Number(),
});

// The running or last job, in the object's storage, so a restarted object still knows its limits and playtests.
interface JobState {
  jobId: string;
  job: Job;
  deadlineAt: number;
  steps: number;
  playtests: PlaytestResult[];
  // Why it was stopped: the deadline, the step limit or a cancel.
  stopped?: string;
}

type Line = CoderEvent | { type: "ping" };

const text = (content: readonly { type: string; text?: string }[]) =>
  content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");

export class DraftCoder extends DurableObject<Env> {
  // Overridden by the contract test's fake box (test/coder/worker.ts).
  boxLayer() {
    return containerBox(this.ctx.container);
  }

  runtime = ManagedRuntime.make(this.boxLayer());
  // One start at a time: a call that finds the box starting waits for it, restore included.
  starting = Semaphore.makeUnsafe(1);

  // The box is a cache over the job: one that stopped (idle, a deploy, a crash) starts again from the unfinished
  // job's source, whether pi resumes the run with nobody connected or a re-POST attaches to it. What the old box held
  // since the job began is gone, and so are its green playtests: the run goes on from the source and must playtest
  // again before it can end `done`.
  up = this.starting.withPermit(
    Effect.gen({ self: this }, function* () {
      const box = yield* Box;
      if (yield* box.running) {
        return;
      }
      yield* box.start;
      const state = this.job;
      if (state && !this.final(state.jobId)) {
        yield* Effect.promise(() => restore(jobBox(box), state.job.source));
        this.job = { ...state, playtests: [] };
      }
    })
  );

  // Every command and file the job touches comes through `up` first.
  box = readyFirst(this.runtime.runSync(Box), () =>
    this.runtime.runPromise(this.up)
  );

  registry = createRegistry();
  // Every open job stream.
  listeners = new Set<(line: Line) => void>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // A box that outlived the object (a crash, an eviction, a deploy) lost its inactivity timeout with it.
    // oxlint-disable-next-line no-void -- blockConcurrencyWhile holds every event until it settles
    void ctx.blockConcurrencyWhile(() =>
      this.runtime.runPromise(
        Effect.gen(function* () {
          const box = yield* Box;
          if (yield* box.running) {
            yield* box.keepAlive;
          }
        }).pipe(
          // Thrown here, it would reset the object, failing every request it holds.
          Effect.catchCause((cause) =>
            Effect.sync(() =>
              console.error(
                `Coder ${this.draftId}: no inactivity timeout`,
                Cause.pretty(cause)
              )
            )
          )
        )
      )
    );
  }

  get draftId() {
    const { name } = this.ctx.id;
    if (!name) {
      throw new Error(
        "A Coder is reached by name: env.CODER.getByName(draftId)"
      );
    }
    return name;
  }

  get job() {
    return this.ctx.storage.kv.get<JobState>("job");
  }

  set job(state: JobState | undefined) {
    this.ctx.storage.kv.put("job", state);
  }

  // The last job's final event only: the Talker re-POSTs no other, and one with music.js runs to hundreds of KB.
  final(jobId: string) {
    const last = this.ctx.storage.kv.get<{ jobId: string; event: CoderEvent }>(
      "final"
    );
    return last?.jobId === jobId ? last.event : undefined;
  }

  emit(line: Line) {
    for (const listener of this.listeners) {
      listener(line);
    }
  }

  stop(reason: string) {
    const { job } = this;
    if (job) {
      this.job = { ...job, stopped: job.stopped ?? reason };
    }
    // oxlint-disable-next-line no-void -- the run ends on its own; its waiter reads `stopped`
    void this.harness.session().abort();
  }

  // The job's ending: the music rendered, the files read back. Its final event is kept for re-POSTs.
  async finish(state: JobState, summary: string) {
    const { event } = await finishJob(jobBox(this.box), {
      deadlineAt: state.deadlineAt,
      deadlineMs: deadlineFor(state.job),
      job: state.job,
      playtests: state.playtests,
      stopped: state.stopped,
      summary: summary.trim(),
    });
    this.ctx.storage.kv.put("final", { event, jobId: state.jobId });
    return event;
  }

  playtest = defineTool({
    description:
      "Typecheck and play the game in headless Chromium (360×640): loads it, taps the centre to start, runs your inputs, and returns the result with screenshots of the start and the end.",
    execute: async ({ inputs }) => {
      const box = jobBox(this.box);
      const result = await boxPlaytest(
        box,
        JSON.stringify({ inputs: inputs ?? [] })
      );
      const { job } = this;
      if (job) {
        this.job = { ...job, playtests: [...job.playtests, result] };
      }
      this.emit({
        errors: [...result.typeErrors, ...result.errors],
        ok: result.ok,
        type: "playtest",
      });
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

  // #116's step limit: the 13th call is blocked and the run aborted. Each step's label goes to the Talker.
  limits = hook(ToolTask, {
    beforeTool: (call) => {
      const { job } = this;
      if (!job || call.parent) {
        return;
      }
      const steps = job.steps + 1;
      this.job = { ...job, steps };
      if (steps > MAX_STEPS) {
        this.stop(`over ${MAX_STEPS} steps`);
        return { block: `Over the ${MAX_STEPS}-step limit.` };
      }
      this.emit({
        label: stepLabel(call.name, call.arguments),
        type: "step",
      });
    },
  });

  // The ending runs inside pi's run, at the model's final answer, so it completes with nobody connected. A stopped run
  // never yields; its request handler ends it.
  ending = hook(GenerationTask, {
    onYield: async (answer) => {
      const state = this.job;
      if (!state || this.final(state.jobId)) {
        return;
      }
      this.emit(await this.finish(state, text(answer.content)));
    },
  });

  harness = new PiHarness({
    defaults: {
      model: { id: this.env.MAKER_CODER_MODEL, provider: "anthropic" },
      thinkingLevel: this.env.MAKER_CODER_EFFORT,
    },
    harness: async ({ storage, context, onWake }) => {
      this.registry.install(CodingTools);
      this.registry.install({
        hooks: [this.limits, this.ending],
        name: "coder",
        sections: [
          { key: "preamble", render: () => SYSTEM_PROMPT, tag: false },
          { key: "project", render: () => PROJECT },
        ],
        tools: [this.playtest],
      });
      this.registry.install(await skills([SKILLS]));
      // Retention 0: pi drops a finished conversation at once; each job starts a fresh one.
      return Harness.open(
        storage,
        {
          env: () => boxEnv(this.box, `box:${this.draftId}`),
          models: piModels(this.env, this.env.MAKER_CODER_MODEL, () => ({
            agent: "coder",
            draftId: this.draftId,
            jobId: this.job?.jobId ?? "none",
          })),
          onWake,
          registry: this.registry,
          settings: { contextRetentionMs: 0, documentRetentionMs: 0 },
        },
        context
      );
    },
  });

  lifecycle = Lifecycle.install(this).use(this.harness);

  // The running job's deadline: armed when it begins, and again whenever the object starts mid-job, since pi resumes
  // a run after a restart with nobody connected.
  deadline = this.armDeadline();

  armDeadline() {
    clearTimeout(this.deadline);
    const state = this.job;
    if (!state || state.stopped || this.final(state.jobId)) {
      return;
    }
    return setTimeout(
      () => {
        if (this.job?.jobId === state.jobId && !this.final(state.jobId)) {
          this.stop(pastDeadline(deadlineFor(state.job) / 1000));
        }
      },
      Math.max(0, state.deadlineAt - Date.now())
    );
  }

  // A new job: the workspace rewritten from its source, a fresh conversation, the job's prompt submitted under its id.
  async begin(jobId: string, job: Job) {
    await restore(jobBox(this.box), job.source);
    const session = this.harness.session();
    if (await session.busy()) {
      await session.abort();
    }
    await session.reset();
    this.job = {
      deadlineAt: Date.now() + deadlineFor(job),
      job,
      jobId,
      playtests: [],
      steps: 0,
    };
    this.deadline = this.armDeadline();
    await this.harness.submit(prompt(job), { operationId: jobId });
  }

  // The job's events until its final one: a job already finished answers at once, a running one is attached to.
  async run(jobId: string, job: Job, send: (line: Line) => void) {
    const stored = this.final(jobId);
    if (stored) {
      send(stored);
      return;
    }
    const up = await this.runtime.runPromise(
      this.up.pipe(
        Effect.as(true),
        // NoBox's message says how to get a box under plain `wrangler dev`.
        Effect.catch((error) =>
          Effect.sync(() => {
            console.error(`Coder ${this.draftId}: no box`, error);
            return false;
          })
        )
      )
    );
    if (!up) {
      // A box that can't start built nothing: `busy`, which the Talker refunds (#122).
      send({ reason: "busy", type: "failed" });
      return;
    }
    if (this.job?.jobId !== jobId) {
      await this.begin(jobId, job);
    }
    const result = await this.harness.wait(jobId);
    const { job: state } = this;
    if (!state) {
      throw new Error(`job ${jobId} ran without its state`);
    }
    send(this.final(jobId) ?? (await this.finish(state, result.text ?? "")));
  }

  override async fetch(request: Request) {
    const { pathname } = new URL(request.url);
    if (request.method === "DELETE" && pathname === "/box") {
      await this.runtime.runPromise(
        Effect.gen(function* () {
          const box = yield* Box;
          if (yield* box.running) {
            yield* box.destroy;
          }
        })
      );
      return new Response(null, { status: 204 });
    }
    const route = JOB_PATH.exec(pathname)?.groups;
    if (request.method !== "POST" || !route?.jobId) {
      return new Response("Not found", { status: 404 });
    }
    const { jobId } = route;
    if (route.cancel) {
      if (this.job?.jobId === jobId && !this.final(jobId)) {
        this.stop("cancelled");
      }
      return new Response(null, { status: 204 });
    }
    let job: Job;
    try {
      job = Schema.decodeUnknownSync(JobSchema)(await request.json());
    } catch (error) {
      return new Response(`Not a job: ${String(error)}`, { status: 400 });
    }

    const { readable, writable } = new TransformStream<Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    let ended = false;
    // One final event per stream, whether the ending or the handler sends it first.
    const send = async (line: Line) => {
      if (ended) {
        return;
      }
      ended = line.type === "done" || line.type === "failed";
      try {
        await writer.write(encoder.encode(`${JSON.stringify(line)}\n`));
      } catch {
        // The Talker hung up; the job runs on, and a re-POST attaches to it.
      }
    };
    const ping = setInterval(() => send({ type: "ping" }), PING_MS);
    this.listeners.add(send);
    const work = async () => {
      try {
        await this.run(jobId, job, send);
      } catch (error) {
        console.error(`Coder ${this.draftId}: job ${jobId}`, error);
        send({ reason: `the coder failed: ${String(error)}`, type: "failed" });
      } finally {
        clearInterval(ping);
        this.listeners.delete(send);
        try {
          await writer.close();
        } catch {
          // Already closed by a Talker that hung up.
        }
      }
    };
    this.ctx.waitUntil(work());
    return new Response(readable, {
      headers: { "content-type": "application/x-ndjson" },
    });
  }
}
