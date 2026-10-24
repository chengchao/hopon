// What the routes (api.ts) and the build tool (talker-build.ts) both keep: Drafts' and Games' files in R2, whose layout
// lives only here, the Draft's box in E2B, and the per-account daily quotas in D1.
import { and, eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { generationLimits } from "./schema.ts";

// R2: a Draft's Revision n at `drafts/<id>/<n>/` (only the current one, and the next for a moment at the end of a turn
// that builds), a published Game at `games/<id>/`, index.html first.
export const draftFiles = (id: string) => `drafts/${id}/`;
export const revisionFiles = (id: string, n: number) => `drafts/${id}/${n}/`;
export const gameFiles = (id: number) => `games/${id}/`;

// Every R2 object under `prefix`: a Draft's or a Revision's files, or a Game's. A Draft holds a Revision or two and a
// Game one, well under a list's 1000 keys.
export const removeFiles = async (files: R2Bucket, prefix: string) => {
  const { objects } = await files.list({ prefix });
  if (objects.length > 0) {
    await files.delete(objects.map((object) => object.key));
  }
};

// A Draft's current Revision n, 0 before its first: the highest `<n>/` in R2.
export const currentRevision = async (files: R2Bucket, id: string) => {
  const { delimitedPrefixes } = await files.list({
    delimiter: "/",
    prefix: draftFiles(id),
  });
  return Math.max(
    0,
    ...delimitedPrefixes.map((prefix) => Number(prefix.split("/")[2]))
  );
};

// Kills the Draft's E2B box, if it has one: on Delete, and when the Talker has been idle (#122).
export const killBox = async (env: Env, id: string) => {
  const response = await env.CODER.getByName(id).fetch("http://coder/box", {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error(`Coder DELETE /box: ${response.status}`);
  }
};

const today = (key: string) =>
  `${key}:${new Date().toISOString().slice(0, 10)}`;

// Atomically counts one use against a per-account UTC-day bucket; false once `max` is reached. Failed attempts still count.
export const spend = async (
  db: DrizzleD1Database,
  key: string,
  max: number
) => {
  const row = await db
    .insert(generationLimits)
    .values({ bucket: today(key), count: 1 })
    .onConflictDoUpdate({
      set: { count: sql`${generationLimits.count} + 1` },
      setWhere: sql`${generationLimits.count} < ${max}`,
      target: generationLimits.bucket,
    })
    .returning({ count: generationLimits.count })
    .get();
  return !!row;
};

// Gives back a use spent on an attempt that never ran (a busy build).
export const refund = async (db: DrizzleD1Database, key: string) => {
  await db
    .update(generationLimits)
    .set({ count: sql`${generationLimits.count} - 1` })
    .where(
      and(
        eq(generationLimits.bucket, today(key)),
        sql`${generationLimits.count} > 0`
      )
    );
};
