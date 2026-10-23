// The Talker's one tool (#143): `build` sends the Draft's Coder one job (src/coder.ts) and turns its `done` into the
// next Revision, `drafts/<id>/<n+1>/` in R2. pi runs it as a durable task with `replay: "safe"`: a Talker restarted
// mid-build runs it again, and the same job id re-attaches to the running job. What a rerun must not redo (the quota,
// the Revision it builds on, a Revision already written) is memoized in pi.
import { once } from "node:events";

import { Type } from "@earendil-works/pi-ai";
import { defineTool, LiveDoc } from "@earendil-works/pi-durable";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Effect } from "effect";
import { decodeBase64 } from "hono/utils/encode";

import { currentRevision, Db, spend } from "./api.ts";
import { drafts, now } from "./schema.ts";

// The Coder's NDJSON (apps/maker/src/coder.ts CoderEvent, plus its ping).
type CoderEvent =
  | { type: "step"; label: string }
  | { type: "playtest"; ok: boolean; errors: string[] }
  | {
      type: "done";
      summary: string;
      files: Record<string, string>;
      deleted: string[];
    }
  | { type: "failed"; reason: string }
  | { type: "ping" };
type Done = Extract<CoderEvent, { type: "done" }>;
type Final = Done | Extract<CoderEvent, { type: "failed" }>;

const DAILY_BUILDS = 10;
// A build with music gets this much more than MAKER_BUILD_ABORT_S, as the Coder's deadline does.
const MUSIC_EXTRA_S = 30;
// What the Talker says for these (its prompt has the lines too).
const BUSY = "The Maker is busy. Try again in a minute.";
const LIMIT = "You've made 10 games today; come back tomorrow.";
// A Revision's files the Coder makes rather than edits (from game.ts and music.mjs), so the job never carries them.
const MUSIC = "music.opus";
const BUILT = new Set(["game.js", MUSIC]);

const Parameters = Type.Object({
  brief: Type.String(),
  music: Type.Union([Type.String(), Type.Null()]),
  title: Type.String(),
});

// Every object under `prefix` gone: an old Revision, or what a failed turn left of a new one.
const remove = async (files: R2Bucket, prefix: string) => {
  const { objects } = await files.list({ prefix });
  if (objects.length > 0) {
    await files.delete(objects.map((object) => object.key));
  }
};

const read = async (files: R2Bucket, key: string) => {
  const object = await files.get(key);
  if (!object) {
    throw new Error(`${key} is missing`);
  }
  return object;
};

// A Revision's files by name, from `drafts/<id>/<n>/`.
const listRevision = async (files: R2Bucket, prefix: string) => {
  const { objects } = await files.list({ prefix });
  return objects.map((object) => object.key.slice(prefix.length));
};

// What the job carries: the Revision's source, which overwrites the box (#122).
const readSource = async (files: R2Bucket, prefix: string, names: string[]) =>
  Object.fromEntries(
    await Promise.all(
      names
        .filter((name) => !BUILT.has(name))
        .map(async (name) => {
          const object = await read(files, `${prefix}${name}`);
          return [name, await object.text()];
        })
    )
  );

// <n+1>/: the carried-over files of <n>/, then the changed ones, without the deleted ones.
const writeRevision = async (
  files: R2Bucket,
  { current, next, names }: { current: string; next: string; names: string[] },
  { files: changed, deleted }: Done
) => {
  const carried = names.filter(
    (name) => !(name in changed) && !deleted.includes(name)
  );
  await Promise.all([
    ...carried.map(async (name) => {
      const object = await read(files, `${current}${name}`);
      await files.put(`${next}${name}`, await object.arrayBuffer());
    }),
    ...Object.entries(changed).map(([name, text]) =>
      files.put(`${next}${name}`, name === MUSIC ? decodeBase64(text) : text)
    ),
  ]);
};

// The job's answer, its `done` or `failed`, with each `step` label passed on as it comes. Undefined if the stream ends
// without one.
const answer = async (response: Response, step: (label: string) => void) => {
  if (!response.body) {
    return;
  }
  let buffer = "";
  for await (const chunk of response.body.pipeThrough(
    new TextDecoderStream()
  )) {
    const lines = `${buffer}${chunk}`.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line) as CoderEvent;
      if (event.type === "step") {
        step(event.label);
      } else if (event.type === "done" || event.type === "failed") {
        return event;
      }
    }
  }
};

const aborted = async (signal: AbortSignal) => {
  if (!signal.aborted) {
    await once(signal, "abort");
  }
  return null;
};

// What the model reads for a build that didn't end `done`.
const failure = (event: Final | null | undefined) => {
  if (event?.type === "failed" && event.reason === "busy") {
    return `The coder is busy. Tell the Creator: "${BUSY}"`;
  }
  return `The build failed: ${event?.type === "failed" ? event.reason : "the coder stopped answering"}`;
};

// One build per turn (#122), and the abort timer counts from the turn's build, so a rerun after a restart keeps it.
// Keyed by pi's run, which a turn's steers join.
interface Turn {
  run: number;
  callId: string;
  startedAt: number;
}

export const buildTool = (
  env: Env,
  draftId: string,
  storage: DurableObjectStorage,
  // Ends the turn as Stop does, so it ends `turn_failed`.
  endTurn: () => void
) =>
  defineTool({
    description:
      "Have the coder build a new game or change this one. Takes about a minute. Returns the coder's report.",
    execute: async (spec, api, context) => {
      const live = await api.snapshot(LiveDoc, api.conversationId, context);
      const run = Number(live?.run?.taskId);
      const turn = await storage.get<Turn>("turn");
      if (turn?.run === run && turn.callId !== api.callId) {
        throw new Error(
          "Only one build per message. Tell the Creator you'll do it next."
        );
      }
      const startedAt = turn?.run === run ? turn.startedAt : Date.now();
      await storage.put("turn", { callId: api.callId, run, startedAt });

      // A value computed once per call and kept across reruns.
      const memo = async <T extends number | boolean>(
        name: string,
        compute: () => Promise<T>
      ) =>
        (await api.memo<T>(name, context)) ??
        (await api.memo(name, await compute(), context));
      const n = await memo("revision", () =>
        currentRevision(env.FILES, draftId)
      );
      const current = `drafts/${draftId}/${n}/`;
      const next = `drafts/${draftId}/${n + 1}/`;
      const db = drizzle(env.DB);

      // A rerun after the Revision was written only finishes the clean-up.
      const written = await api.memo<string>("summary", context);
      if (written !== undefined) {
        await remove(env.FILES, current);
        return { output: [{ text: written, type: "text" as const }] };
      }

      const spent = await memo("spent", async () => {
        const draft = await db
          .select({ owner: drafts.owner })
          .from(drafts)
          .where(eq(drafts.id, draftId))
          .get();
        return (
          !!draft &&
          (await Effect.runPromise(
            spend(draft.owner, DAILY_BUILDS).pipe(Effect.provideService(Db, db))
          ))
        );
      });
      if (!spent) {
        throw new Error(
          `The daily limit is reached. Tell the Creator: "${LIMIT}"`
        );
      }

      const names = await listRevision(env.FILES, current);
      const source = await readSource(env.FILES, current, names);
      const coder = env.CODER.getByName(draftId);
      const jobId = `${draftId}-${api.callId}`;
      const signal = context.abortSignal ?? new AbortController().signal;
      const abortMs =
        (Number(env.MAKER_BUILD_ABORT_S) + (spec.music ? MUSIC_EXTRA_S : 0)) *
        1000;
      const timer = setTimeout(endTurn, startedAt + abortMs - Date.now());
      const job = async () => {
        const response = await coder.fetch(`http://coder/jobs/${jobId}`, {
          body: JSON.stringify({ draftId, revision: n, source, spec }),
          method: "POST",
        });
        return answer(response, (label) => api.output(`${label}\n`));
      };
      let event: Final | null | undefined;
      try {
        event = await Promise.race([job(), aborted(signal)]);
      } finally {
        clearTimeout(timer);
      }

      try {
        if (signal.aborted) {
          await coder.fetch(`http://coder/jobs/${jobId}/cancel`, {
            method: "POST",
          });
          throw new Error("Stopped.");
        }
        if (event?.type !== "done") {
          throw new Error(failure(event));
        }
        await writeRevision(env.FILES, { current, names, next }, event);
        await db
          .update(drafts)
          .set({ title: spec.title, updatedAt: now })
          .where(eq(drafts.id, draftId));
        await api.memo("summary", event.summary, context);
      } catch (error) {
        // A failed, stopped or half-written build leaves no <n+1>/, which the preview route would take as current.
        await remove(env.FILES, next);
        throw error;
      }
      await remove(env.FILES, current);
      return { output: [{ text: event.summary, type: "text" as const }] };
    },
    name: "build",
    parameters: Parameters,
    replay: "safe",
  });
