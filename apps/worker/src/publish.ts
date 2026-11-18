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
import {
  currentRevision,
  draftFiles,
  removeFiles,
  revisionFiles,
} from "./storage.ts";
import { toolResult } from "./tool-results.ts";

// A Revision's files the harness makes rather than the agent (from game.ts and the music's score).
const BUILT = new Set(["game.js", "music.js"]);
const SCORES = ["music.mjs", "music.py"];
const TESTS = "tests.json";
const DESIGN = "design.md";
// What the Creator has said, for verify.js's `Music: none` rule: their messages as a JSON array. The check's sweep
// removes it with everything but the game's source, so `build` writes it again after the check; it never reaches a
// Revision.
const ASKED = ".hopon/asked.json";
// A Revision's last file written: one without it is a write an eviction cut short, which currentRevision skips.
const INDEX = "index.html";
const NODE = "/usr/local/bin/node";
const VERIFY = "/opt/hopon/verify.js";

const read = async (files: R2Bucket, key: string) => {
  const object = await files.get(key);
  if (!object) {
    throw new Error(`${key} is missing`);
  }
  return object;
};

// Revision n's file names and source: what restore() puts back in the workspace, the agent's design.md and tests.json
// included.
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
  box.write(`${WORKSPACE}/${ASKED}`, JSON.stringify(asked));

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

// verify.js's failures, none when it passes. A new game must have music, and so must a change to a game that had it.
const verify = async (box: Box, kind: "new" | "change", hadMusic: boolean) => {
  const verified = await box.exec([
    "/bin/sh",
    "-c",
    `cd ${WORKSPACE} && ${NODE} ${VERIFY} ${kind}${hadMusic ? " --had-music" : ""}`,
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

const list = (lines: readonly string[]) =>
  lines.map((line) => `- ${line}`).join("\n");

// Tool and parameter descriptions stay beside their types: they are the tool's schema, sent with it, and each one
// describes the field next to it.
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
  // What the Creator has said since their last new game.
  asked: () => readonly string[],
  // Whether the box started again, from the current Revision, since the agent was last told.
  restarted: () => boolean,
  // The workspace now holds Revision n, a new game or a change.
  published: (n: number, kind: "new" | "change") => void
) =>
  defineTool({
    description:
      "Check the game in the workspace and, if it passes, publish it to the Creator. It runs verify.js, typechecks the game, renders its music, plays it for a second and runs tests.json; a failure comes back as the errors to fix.",
    execute: async (spec, api, context) => {
      api.output("Checking the game\n");
      const workspace = box(context?.abortSignal);
      // Every box call brings a stopped box up again, restored to Revision n: a verdict after that is the old game's,
      // and the agent is told its work is gone instead.
      const refuse = (text: string) =>
        new Error(restarted() ? toolResult("restarted") : text);
      const { n, names, source } = await revisionSource(env.FILES, draftId);
      if (spec.kind === "change" && n === 0) {
        throw new Error(toolResult("no-game"));
      }
      await writeAsked(workspace, asked());
      const failures = await verify(
        workspace,
        spec.kind,
        names.some((name) => SCORES.includes(name))
      );
      if (failures.length > 0) {
        throw refuse(toolResult("not-ready", { FAILURES: list(failures) }));
      }
      const tests = await readTests(workspace);
      if (tests.error) {
        throw refuse(tests.error);
      }
      const fresh = spec.kind === "new";
      const scores = await Promise.all(
        SCORES.map((file) => readText(workspace, file))
      );
      const job: Job = {
        draftId,
        revision: n,
        source: fresh ? {} : source,
        spec: {
          music:
            spec.music || scores.some((text) => text !== null) ? "yes" : null,
          tests: tests.tests,
          title: spec.title,
        },
      };
      const design = await readText(workspace, DESIGN);
      const verdict = await checkBuild(workspace, { job });
      // The check leaves only the game's source in the workspace; the agent's own files go back.
      const notes = Object.fromEntries(
        [
          [TESTS, tests.text],
          [DESIGN, design],
        ].filter((note): note is [string, string] => note[1] !== null)
      );
      await Promise.all([
        ...Object.entries(notes).map(([file, text]) =>
          workspace.write(`${WORKSPACE}/${file}`, text)
        ),
        writeAsked(workspace, asked()),
      ]);
      // A pass of the old game must not become n+1.
      if (restarted()) {
        throw new Error(toolResult("restarted"));
      }
      const threw = verdict.testErrors ?? [];
      const skipped =
        threw.length > 0
          ? `\n${toolResult("skipped", { ERRORS: threw.join(" | ") })}`
          : "";
      if ("errors" in verdict) {
        throw refuse(
          toolResult("check-failed", {
            ERRORS: list(verdict.errors),
            SKIPPED: skipped,
          })
        );
      }
      // <n+1>/: the carried-over files of <n>/, then the changed ones and the agent's notes, without the deleted ones.
      // index.html goes last, so an eviction mid-write leaves a Revision currentRevision skips, and the next build
      // starts <n+1>/ over.
      const files: Record<string, string> = { ...verdict.files, ...notes };
      const current = revisionFiles(draftId, n);
      const next = revisionFiles(draftId, n + 1);
      const carried = (fresh ? [] : names).filter(
        (name) => !(name in files) && !verdict.deleted.includes(name)
      );
      const put = async (name: string) => {
        const text = files[name];
        if (text !== undefined) {
          await env.FILES.put(`${next}${name}`, text);
          return;
        }
        const object = await read(env.FILES, `${current}${name}`);
        await env.FILES.put(`${next}${name}`, await object.arrayBuffer());
      };
      try {
        await removeFiles(env.FILES, next);
        await Promise.all(
          [...carried, ...Object.keys(files)]
            .filter((name) => name !== INDEX)
            .map(put)
        );
        await put(INDEX);
        await drizzle(env.DB)
          .update(drafts)
          .set({
            description: spec.description,
            title: spec.title,
            updatedAt: now,
          })
          .where(eq(drafts.id, draftId));
      } catch (error) {
        await removeFiles(env.FILES, next);
        throw error;
      }
      // Every other Revision goes: n, and any an eviction left before it was removed.
      const { delimitedPrefixes } = await env.FILES.list({
        delimiter: "/",
        prefix: draftFiles(draftId),
      });
      await Promise.all(
        delimitedPrefixes
          .filter((prefix) => prefix !== next)
          .map((prefix) => removeFiles(env.FILES, prefix))
      );
      published(n + 1, spec.kind);
      return {
        output: [
          {
            text: toolResult("published", { N: n + 1, SKIPPED: skipped }),
            type: "text" as const,
          },
        ],
      };
    },
    executionMode: "sequential",
    name: "build",
    parameters: Parameters,
  });
