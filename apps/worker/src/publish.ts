// The Maker's `build` tool (ADR 0006): it publishes the game in the workspace to the Creator. It runs verify.js, then
// the harness check (job.ts's checkBuild: the music, the agent's own tests.json, the typecheck), then writes Revision
// n+1 to R2 and the Draft's title and description to D1. A failed check is the tool's error result, which the agent
// fixes before it calls `build` again. The tool keeps the old main agent's name because the app's chat reads it: a
// `build` result is the game card, and a running `build` is the status line.
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import { GAME_DESCRIPTION_MAX, GAME_TITLE_MAX } from "@hopon/schemas";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Schema } from "effect";

import { checkBuild, TestsSchema, WORKSPACE } from "../../maker/src/job.ts";
import type { Box, Job, Tests } from "../../maker/src/job.ts";
import { drafts, now } from "./schema.ts";
import { currentRevision, removeFiles, revisionFiles } from "./storage.ts";

// A Revision's files the harness makes rather than the agent (from game.ts and the music's score).
const BUILT = new Set(["game.js", "music.js"]);
const SCORES = ["music.mjs", "music.py"];
const TESTS = "tests.json";
const DESIGN = "design.md";
// What the Creator has said, for verify.js's `Music: none` rule. The check's sweep removes it with everything but the
// game's source, so it never reaches a Revision.
const ASKED = ".hopon/asked.txt";
const NODE = "/usr/local/bin/node";
const VERIFY = "/opt/hopon/verify.js";

const read = async (files: R2Bucket, key: string) => {
  const object = await files.get(key);
  if (!object) {
    throw new Error(`${key} is missing`);
  }
  return object;
};

// Revision n's file names and source: what restore() puts back in the workspace.
export const revisionSource = async (files: R2Bucket, draftId: string) => {
  const n = await currentRevision(files, draftId);
  const prefix = revisionFiles(draftId, n);
  const { objects } = n === 0 ? { objects: [] } : await files.list({ prefix });
  const names = objects.map((object) => object.key.slice(prefix.length));
  const source: Record<string, string> = Object.fromEntries(
    await Promise.all(
      names
        .filter((name) => !BUILT.has(name))
        .map(async (name) => {
          const object = await read(files, `${prefix}${name}`);
          return [name, await object.text()];
        })
    )
  );
  return { n, names, source };
};

export const writeAsked = (box: Box, asked: readonly string[]) =>
  box.write(`${WORKSPACE}/${ASKED}`, asked.join("\n\n"));

const readText = async (box: Box, file: string) => {
  try {
    return await box.read(`${WORKSPACE}/${file}`);
  } catch {
    return null;
  }
};

// tests.json, or why it can't be run.
const readTests = async (
  box: Box
): Promise<{ tests?: Tests; text: string | null; error?: string }> => {
  const text = await readText(box, TESTS);
  if (text === null) {
    return { text };
  }
  try {
    return {
      tests: Schema.decodeUnknownSync(TestsSchema)(JSON.parse(text)),
      text,
    };
  } catch (error) {
    return {
      error: `${TESTS} isn't valid: ${String(error).slice(0, 300)}`,
      text,
    };
  }
};

// verify.js's failures, none when it passes.
const verify = async (box: Box) => {
  const verified = await box.exec([
    "/bin/sh",
    "-c",
    `cd ${WORKSPACE} && ${NODE} ${VERIFY}`,
  ]);
  if (verified.exitCode === 0) {
    return [];
  }
  try {
    return (JSON.parse(verified.stdout) as { failures: string[] }).failures;
  } catch {
    return [`verify.js failed: ${verified.stderr.slice(0, 300)}`];
  }
};

const Parameters = Type.Object({
  description: Type.String({ maxLength: GAME_DESCRIPTION_MAX }),
  kind: Type.Union([Type.Literal("new"), Type.Literal("change")], {
    description:
      "new: a new game, a different game, or Start over; change: a change to the current game",
  }),
  music: Type.Boolean({
    description:
      "true when the game has music; the harness renders the workspace's music file whenever there is one",
  }),
  title: Type.String({ maxLength: GAME_TITLE_MAX, minLength: 1 }),
});

export const publishTool = (
  env: Env,
  draftId: string,
  box: (signal?: AbortSignal) => Box,
  // Everything the Creator has said in this chat.
  asked: () => readonly string[],
  // The workspace now holds Revision n.
  published: (n: number) => void
) =>
  defineTool({
    description:
      "Check the game in the workspace and, if it passes, publish it to the Creator. It runs verify.js, typechecks the game, renders its music, plays it for a second and runs tests.json; a failure comes back as the errors to fix.",
    execute: async (spec, api, context) => {
      api.output("Checking the game\n");
      const workspace = box(context?.abortSignal);
      await writeAsked(workspace, asked());
      const failures = await verify(workspace);
      if (failures.length > 0) {
        throw new Error(`Not ready to publish:\n- ${failures.join("\n- ")}`);
      }
      const tests = await readTests(workspace);
      if (tests.error) {
        throw new Error(tests.error);
      }
      const { n, names, source } = await revisionSource(env.FILES, draftId);
      const fresh = spec.kind === "new";
      const scores = await Promise.all(
        SCORES.map((file) => readText(workspace, file))
      );
      const job: Job = {
        draftId,
        revision: n,
        source: fresh ? {} : source,
        spec: {
          brief: "",
          music:
            spec.music || scores.some((text) => text !== null) ? "yes" : null,
          tests: tests.tests,
          title: spec.title,
        },
      };
      const design = await readText(workspace, DESIGN);
      const verdict = await checkBuild(workspace, { job });
      // The check leaves only the game's source in the workspace; the agent's tests and design stay with it.
      if (tests.text !== null) {
        await workspace.write(`${WORKSPACE}/${TESTS}`, tests.text);
      }
      if (design !== null) {
        await workspace.write(`${WORKSPACE}/${DESIGN}`, design);
      }
      const threw = verdict.testErrors ?? [];
      const skipped =
        threw.length > 0
          ? `\nThese checks threw and were skipped; fix them in ${TESTS}: ${threw.join(" | ")}`
          : "";
      if ("errors" in verdict) {
        throw new Error(
          `The harness check failed:\n${verdict.errors.map((error) => `- ${error}`).join("\n")}${skipped}\nFix these, playtest, then call build again.`
        );
      }
      // <n+1>/: the carried-over files of <n>/, then the changed ones, without the deleted ones.
      const current = revisionFiles(draftId, n);
      const next = revisionFiles(draftId, n + 1);
      const carried = (fresh ? [] : names).filter(
        (name) => !(name in verdict.files) && !verdict.deleted.includes(name)
      );
      try {
        await Promise.all([
          ...carried.map(async (name) => {
            const object = await read(env.FILES, `${current}${name}`);
            await env.FILES.put(`${next}${name}`, await object.arrayBuffer());
          }),
          ...Object.entries(verdict.files).map(([name, text]) =>
            env.FILES.put(`${next}${name}`, text)
          ),
        ]);
        await drizzle(env.DB)
          .update(drafts)
          .set({
            description: spec.description,
            title: spec.title,
            updatedAt: now,
          })
          .where(eq(drafts.id, draftId));
      } catch (error) {
        // A half-written <n+1>/ would be taken as current.
        await removeFiles(env.FILES, next);
        throw error;
      }
      await removeFiles(env.FILES, current);
      published(n + 1);
      return {
        output: [
          {
            text: `Published: the Creator now has Revision ${n + 1}.${skipped}`,
            type: "text" as const,
          },
        ],
      };
    },
    executionMode: "sequential",
    name: "build",
    parameters: Parameters,
  });
