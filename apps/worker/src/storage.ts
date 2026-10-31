// What the routes (api.ts) and the build tool (talker-build.ts) both keep: Drafts' and Games' files in R2, whose layout
// lives only here, the Draft's box (its Coder's container), the per-account daily quotas and the Maker's weekly
// Allowance (ADR 0004) in D1.
import { and, eq, notLike, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { drafts, generationLimits } from "./schema.ts";

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

// Kills the Draft's box, if it has one, when the Draft is deleted. An idle box stops on its own (src/coder-box.ts).
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

const DAY_MS = 86_400_000;

// The ISO week `at` falls in, "2026-W44", and when it ends: weeks start Monday 00:00 UTC. A week belongs to the year
// its Thursday is in.
export const week = (at = Date.now()) => {
  const monday = Math.floor(at / DAY_MS - ((new Date(at).getUTCDay() + 6) % 7));
  const thursday = new Date((monday + 3) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const n =
    Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1;
  return {
    key: `${year}-W${String(n).padStart(2, "0")}`,
    resetsAt: new Date((monday + 7) * DAY_MS).toISOString(),
  };
};

const allowanceBucket = (account: string) => `${account}:${week().key}`;

// What's left of the account's weekly Allowance, `weekly` hopon tokens. Below zero when the last turn overshot.
export const allowanceLeft = async (
  db: DrizzleD1Database,
  account: string,
  weekly: number
) => {
  const row = await db
    .select({ count: generationLimits.count })
    .from(generationLimits)
    .where(eq(generationLimits.bucket, allowanceBucket(account)))
    .get();
  return weekly - (row?.count ?? 0);
};

// Deletes every bucket but today's and this week's, which are all spend() and the Allowance read: run daily by the
// Worker's cron (src/index.ts), or generation_limits grows by a row per account each day (#39).
export const pruneLimits = (db: DrizzleD1Database, at = Date.now()) =>
  db
    .delete(generationLimits)
    .where(
      and(
        notLike(
          generationLimits.bucket,
          `%:${new Date(at).toISOString().slice(0, 10)}`
        ),
        notLike(generationLimits.bucket, `%:${week(at).key}`)
      )
    );

// One hopon token is one Haiku 5.5 input token, $0.10 a million (ADR 0004).
const HOPON_TOKENS_PER_DOLLAR = 10_000_000;

// Adds a model call's cost (pi's `usage.cost.total`, in dollars) to the Draft owner's week, as hopon tokens, rounded
// up. The 1e-6 keeps float noise ($0.011 × 1e7 = 110000.00000000001) from rounding up a whole token. A Draft deleted
// mid-build has no owner left to charge.
export const charge = async (
  db: DrizzleD1Database,
  draftId: string,
  cost: number
) => {
  const tokens = Math.ceil(cost * HOPON_TOKENS_PER_DOLLAR - 1e-6);
  if (tokens <= 0) {
    return;
  }
  const suffix = `:${week().key}`;
  await db.run(
    sql`INSERT INTO ${generationLimits} (bucket, count)
      SELECT ${drafts}.owner || ${suffix}, ${tokens} FROM ${drafts} WHERE ${drafts}.id = ${draftId}
      ON CONFLICT (bucket) DO UPDATE SET count = count + excluded.count`
  );
};
