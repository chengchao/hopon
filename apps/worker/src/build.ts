// The main agent's one tool (#143, ADR 0005): `build` gives the sub agent one job, in a child conversation the call
// owns, and turns its `done` into the next Revision, `drafts/<id>/<n+1>/` in R2. pi runs it as a durable task with
// `replay: "safe"`: a Maker restarted mid-build runs it again, finds the same child and the same job, and waits for it.
// What a rerun must not redo (the Allowance check, the Revision it builds on, a Revision already written) is memoized
// in pi.
import { once } from "node:events";

import { Type } from "@earendil-works/pi-ai";
import { configure, defineTool, LiveDoc } from "@earendil-works/pi-durable";
import type { AgentChange, ConversationId } from "@earendil-works/pi-durable";
import { GAME_DESCRIPTION_MAX, GAME_TITLE_MAX } from "@hopon/schemas";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import type { CoderEvent, Job } from "../../maker/src/job.ts";
import { BUSY, USED_UP } from "./main-prompt.ts";
import { drafts, now } from "./schema.ts";
import {
  allowanceLeft,
  currentRevision,
  removeFiles,
  revisionFiles,
} from "./storage.ts";

type Done = Extract<CoderEvent, { type: "done" }>;
export type Final = Done | Extract<CoderEvent, { type: "failed" }>;

// What `build` needs of the Maker: the sub agent's configuration, and its jobs.
export interface SubAgent {
  readonly agent: () => AgentChange;
  // The job's `done` or `failed`, with each step's label passed on as it comes. A job already running or finished is
  // waited for or answered, not started again. The turn's abort stops it.
  readonly run: (
    job: { jobId: string; job: Job; conversation: ConversationId },
    step: (label: string) => void,
    signal: AbortSignal
  ) => Promise<Final>;
}

// A build with music gets this much more than MAKER_BUILD_ABORT_S, as the sub agent's deadline does.
const MUSIC_EXTRA_S = 30;
// A Revision's files the sub agent makes rather than edits (from game.ts and music.mjs), so the job never carries them.
const BUILT = new Set(["game.js", "music.js"]);

// The title and description are what Publish shows in the feed, within games' limits (schema.ts).
const Parameters = Type.Object({
  brief: Type.String(),
  description: Type.String({ maxLength: GAME_DESCRIPTION_MAX }),
  music: Type.Union([Type.String(), Type.Null()]),
  title: Type.String({ maxLength: GAME_TITLE_MAX, minLength: 1 }),
});

const read = async (files: R2Bucket, key: string) => {
  const object = await files.get(key);
  if (!object) {
    throw new Error(`${key} is missing`);
  }
  return object;
};

// A Revision's files by name.
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
      files.put(`${next}${name}`, text)
    ),
  ]);
};

const aborted = async (signal: AbortSignal) => {
  if (!signal.aborted) {
    await once(signal, "abort");
  }
  return null;
};

// What the model reads for a build that didn't end `done`.
const failure = ({ reason }: Extract<Final, { type: "failed" }>) =>
  reason === "busy"
    ? `The coder is busy. Tell the Creator: "${BUSY}"`
    : `The build failed: ${reason}`;

// One build per turn (#122), and the abort timer counts from the turn's build, so a rerun after a restart keeps it.
// Keyed by the input that began pi's run, which a turn's steers join; the run's taskId changes every tool round.
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
  endTurn: () => void,
  sub: SubAgent
) =>
  defineTool({
    description:
      "Have the coder build a new game or change this one. Takes about a minute. Returns the coder's report.",
    execute: async (spec, api, context) => {
      const live = await api.snapshot(LiveDoc, api.conversationId, context);
      const run = Number(live?.run?.inputs[0]);
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
      const current = revisionFiles(draftId, n);
      const next = revisionFiles(draftId, n + 1);
      const db = drizzle(env.DB);

      // A rerun after the Revision was written only finishes the clean-up.
      const written = await api.memo<string>("summary", context);
      if (written !== undefined) {
        await removeFiles(env.FILES, current);
        return { output: [{ text: written, type: "text" as const }] };
      }

      // A build starts only while the Allowance is above zero (ADR 0004): the turn's first model call may have used the
      // rest. One that starts finishes, and its cost may take the balance below zero.
      const allowed = await memo("allowed", async () => {
        const draft = await db
          .select({ owner: drafts.owner })
          .from(drafts)
          .where(eq(drafts.id, draftId))
          .get();
        return (
          !!draft &&
          (await allowanceLeft(
            db,
            draft.owner,
            Number(env.MAKER_WEEKLY_TOKENS)
          )) > 0
        );
      });
      if (!allowed) {
        throw new Error(
          `The weekly Allowance is used up. Tell the Creator: "${USED_UP}"`
        );
      }

      const names = await listRevision(env.FILES, current);
      const source = await readSource(env.FILES, current, names);
      const jobId = `${draftId}-${api.callId}`;
      // The sub agent's conversation, owned by this call: a rerun finds it, and it goes when the call ends.
      const conversation = await api.commit(async (tx) => {
        const {
          items: [owned],
        } = await tx.scanConversations({ ownerTaskId: api.taskId }, 1);
        if (owned) {
          return owned.id;
        }
        const created = await tx.createConversation({
          ownership: { kind: "task", taskId: api.taskId },
        });
        await configure(tx, created.id, sub.agent());
        return created.id;
      }, context);
      const signal = context.abortSignal ?? new AbortController().signal;
      const abortMs =
        (Number(env.MAKER_BUILD_ABORT_S) + (spec.music ? MUSIC_EXTRA_S : 0)) *
        1000;
      const timer = setTimeout(endTurn, startedAt + abortMs - Date.now());
      const job = () =>
        sub.run(
          { conversation, job: { draftId, revision: n, source, spec }, jobId },
          (label) => api.output(`${label}\n`),
          signal
        );
      let event: Final | null;
      try {
        event = await Promise.race([job(), aborted(signal)]);
      } finally {
        clearTimeout(timer);
      }

      try {
        if (signal.aborted || !event) {
          throw new Error("Stopped.");
        }
        if (event.type !== "done") {
          throw new Error(failure(event));
        }
        await writeRevision(env.FILES, { current, names, next }, event);
        await db
          .update(drafts)
          .set({
            description: spec.description,
            title: spec.title,
            updatedAt: now,
          })
          .where(eq(drafts.id, draftId));
        await api.memo("summary", event.summary, context);
      } catch (error) {
        // A failed, stopped or half-written build leaves no <n+1>/, which the preview route would take as current.
        await removeFiles(env.FILES, next);
        throw error;
      }
      await removeFiles(env.FILES, current);
      return { output: [{ text: event.summary, type: "text" as const }] };
    },
    name: "build",
    parameters: Parameters,
    replay: "safe",
  });
