// The Coder's server in its Container (#122, #139): one instance per Draft, one job at a time, reached only over the
// Worker's private binding.
//   POST /jobs/:jobId         the job in, NDJSON events out; attaches to it while it runs or for 10 min after
//   POST /jobs/:jobId/cancel  ends it `failed`
//   DELETE /box               kills the Draft's box
// The box and the model are Effect services, so the tests fake both at their edges.
import type { Api, Model } from "@earendil-works/pi-ai";
import type { Sandbox } from "e2b";
import { Cause, Context, Effect, Fiber, Layer, Schema } from "effect";

import { killBox, openBox } from "./box.ts";
import { runJob } from "./coder.ts";
import type { Thinking } from "./coder.ts";
import { deadlineFor, JobSchema } from "./job.ts";
import type { CoderEvent, Job } from "./job.ts";
import {
  CANDIDATES,
  isCandidate,
  networkHandler,
  routeModels,
} from "./models.ts";
import type { ModelHandler } from "./models.ts";

const PING_MS = 10_000;
// ponytail: the record is in memory, so a finished job is attachable only while the container is up (it sleeps 2 min
// after the last request); after that the same jobId builds again from the same body. Persist the final event if that
// double build ever costs.
const ATTACH_MS = 600_000;
// pi's levels; Claude 5.5 needs one above "off" (#115).
const THINKING = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
const isThinking = (effort: string): effort is Thinking =>
  (THINKING as readonly string[]).includes(effort);
const decodeJob = Schema.decodeUnknownEffect(Schema.fromJsonString(JobSchema));
// A promise whose rejection stays the error itself, so a failed job's reason says what failed (E2B, the box, pi)
// rather than tryPromise's generic UnknownError.
const attempt = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ catch: (error) => error, try: run });

export class Box extends Context.Service<
  Box,
  {
    open: (draftId: string) => Promise<Sandbox>;
    pause: (sandbox: Sandbox) => Promise<void>;
    kill: (draftId: string) => Promise<void>;
  }
>()("hopon/maker/Box") {}

export class Models extends Context.Service<
  Models,
  { model: Model<Api>; thinking: Thinking; handler: ModelHandler }
>()("hopon/maker/Models") {}

export const BoxLive = Layer.succeed(Box)({
  kill: killBox,
  open: openBox,
  pause: async (sandbox) => {
    await sandbox.pause();
  },
});

// The model and its effort come from the Worker's MAKER_CODER_MODEL and MAKER_CODER_EFFORT, never from the job.
export const modelsLive = (modelId: string, thinking: string) => {
  if (!isCandidate(modelId)) {
    throw new Error(`MAKER_CODER_MODEL ${modelId} is not a Coder model`);
  }
  if (!isThinking(thinking)) {
    throw new Error(
      `MAKER_CODER_EFFORT ${thinking} is not one of ${THINKING.join(", ")}`
    );
  }
  return Layer.succeed(Models)({
    handler: networkHandler,
    model: CANDIDATES[modelId](),
    thinking,
  });
};

// A job as it runs here: its events so far and the streams following it.
interface Run {
  id: string;
  events: CoderEvent[];
  listeners: Set<(event: CoderEvent) => void>;
  cancel: AbortController;
  deadline?: ReturnType<typeof setTimeout>;
  endedAt?: number;
}

const isFinal = (event: CoderEvent) =>
  event.type === "done" || event.type === "failed";

// The first `done` or `failed` is the job's answer; anything after it is dropped.
const record = (run: Run, event: CoderEvent) => {
  if (run.endedAt !== undefined) {
    return;
  }
  run.events.push(event);
  if (isFinal(event)) {
    run.endedAt = Date.now();
    clearTimeout(run.deadline);
  }
  for (const listener of run.listeners) {
    listener(event);
  }
};

const failedNow = (id: string, reason: string): Run => ({
  cancel: new AbortController(),
  endedAt: Date.now(),
  events: [{ reason, type: "failed" }],
  id,
  listeners: new Set(),
});

// The job's events so far, then the rest as they come, with a ping every 10 s; it closes after `done` or `failed`.
const ndjson = (run: Run, pingMs: number) => {
  const encoder = new TextEncoder();
  let ping: ReturnType<typeof setInterval> | undefined;
  let listener: ((event: CoderEvent) => void) | undefined;
  const stop = () => {
    clearInterval(ping);
    if (listener) {
      run.listeners.delete(listener);
    }
  };
  return new Response(
    new ReadableStream<Uint8Array>({
      cancel: stop,
      start: (controller) => {
        const send = (event: CoderEvent | { type: "ping" }) => {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };
        listener = (event) => {
          send(event);
          if (isFinal(event)) {
            stop();
            controller.close();
          }
        };
        ping = setInterval(() => send({ type: "ping" }), pingMs);
        for (const event of run.events) {
          listener(event);
        }
        if (run.endedAt === undefined) {
          run.listeners.add(listener);
        }
      },
    }),
    { headers: { "content-type": "application/x-ndjson" } }
  );
};

// One job in its box: opened (resumed or made) first, paused after whatever happened. The deadline counts from the
// job's arrival and ends it `failed` on time even while the box opens or the music renders; runJob is stopped too.
// `previous` is the build before it, which may still be letting go of the box after its job ended `failed`.
const build = (
  job: Job,
  run: Run,
  deadlineMs: number,
  previous: Effect.Effect<void>
) =>
  Effect.gen(function* () {
    const box = yield* Box;
    const { handler, model, thinking } = yield* Models;
    routeModels(handler);
    const startedAt = Date.now();
    run.deadline = setTimeout(() => {
      record(run, {
        reason: `past the ${deadlineMs / 1000} s deadline`,
        type: "failed",
      });
      run.cancel.abort();
    }, deadlineMs);
    yield* previous;
    yield* Effect.acquireUseRelease(
      attempt(() => box.open(job.draftId)),
      (sandbox) =>
        attempt(() =>
          runJob({
            deadlineMs,
            job,
            model,
            onEvent: (event) => record(run, event),
            sandbox,
            signal: run.cancel.signal,
            startedAt,
            thinking,
          })
        ),
      (sandbox) => attempt(() => box.pause(sandbox)).pipe(Effect.ignore)
    );
  }).pipe(
    // A box or E2B failure still ends the job, so the Talker never waits on a stream that stops short.
    Effect.catchCause((cause) =>
      Effect.sync(() =>
        record(run, {
          reason: `coder error: ${String(Cause.squash(cause))}`.slice(0, 500),
          type: "failed",
        })
      )
    ),
    Effect.withSpan("build")
  );

export interface CoderOptions {
  // The Draft this instance serves: its Container's name. A job for any other Draft is refused.
  draftId: string;
  // The tests' short ones; otherwise 120 s (150 s with music) and 10 s.
  deadlineMs?: number;
  pingMs?: number;
}

// The server as a fetch handler; main.ts serves it over HTTP.
export const makeCoder = (
  services: Layer.Layer<Box | Models>,
  { draftId, deadlineMs, pingMs = PING_MS }: CoderOptions
) => {
  let current: Run | undefined;
  let building: Fiber.Fiber<void> | undefined;
  const live = (id: string) =>
    current?.id === id &&
    (current.endedAt === undefined || Date.now() - current.endedAt < ATTACH_MS);

  const route = Effect.fn("route")(function* (request: Request) {
    const { pathname } = new URL(request.url);
    const [, jobs, id, action] = pathname.split("/");
    if (request.method === "DELETE" && pathname === "/box") {
      const box = yield* Box;
      return yield* attempt(() => box.kill(draftId)).pipe(
        Effect.as(new Response(null, { status: 204 })),
        Effect.catch((error) =>
          Effect.succeed(
            new Response(`Could not kill the box: ${String(error)}`, {
              status: 502,
            })
          )
        )
      );
    }
    if (request.method !== "POST" || jobs !== "jobs" || !id) {
      return new Response("Not found", { status: 404 });
    }
    if (action === "cancel") {
      // Ended at once; runJob stops behind it, and the next job waits for its box.
      if (current && live(id)) {
        record(current, { reason: "cancelled", type: "failed" });
        current.cancel.abort();
      }
      return new Response(null, { status: 204 });
    }
    if (action !== undefined) {
      return new Response("Not found", { status: 404 });
    }
    if (current && live(id)) {
      return ndjson(current, pingMs);
    }
    if (current && current.endedAt === undefined) {
      // ponytail: a second Draft job while one runs is refused, never queued; the Talker runs one build per turn.
      return ndjson(failedNow(id, "busy"), pingMs);
    }
    const text = yield* Effect.promise(() => request.text());
    const job = yield* decodeJob(text).pipe(Effect.option);
    if (job._tag === "None" || job.value.draftId !== draftId) {
      return new Response(`Not a job for Draft ${draftId}`, { status: 400 });
    }
    const run: Run = {
      cancel: new AbortController(),
      events: [],
      id,
      listeners: new Set(),
    };
    current = run;
    building = yield* Effect.forkDetach(
      build(
        job.value,
        run,
        deadlineMs ?? deadlineFor(job.value),
        building ? Fiber.join(building) : Effect.void
      )
    );
    return ndjson(run, pingMs);
  });

  return (request: Request) =>
    Effect.runPromise(route(request).pipe(Effect.provide(services)));
};
