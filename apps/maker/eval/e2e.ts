// The end-to-end run (#115's smoke of the winning pair, run here as a test): the real Talker through its scripted
// chats, each `build` running the real Coder in a box against the chat's Draft, which carries from build to build.
// Every built game is judged against the brief the Talker wrote; the chat is judged as in the Talker sweep.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import type { Thinking } from "../src/coder.ts";
import { runCoder } from "./coder.ts";
import type { CoderRecord } from "./coder.ts";
import { runTalker } from "./talker.ts";
import type { Chat } from "./talker.ts";

const SOURCE_FILES = ["game.ts", "index.html", "music.mjs"];

export const runE2E = async ({
  talkerModel,
  coderModel,
  thinking,
  chat,
  run,
  dir,
}: {
  talkerModel: string;
  coderModel: string;
  thinking: Thinking;
  chat: Chat;
  run: number;
  dir: string;
}) => {
  const draft = { n: 0, source: {} as Record<string, string> };
  const builds: CoderRecord[] = [];
  const talker = await runTalker({
    chat,
    coder: async (spec) => {
      const buildDir = path.join(dir, `build-${builds.length + 1}`);
      const record = await runCoder({
        dir: buildDir,
        job: {
          id: `${chat.id}-${builds.length + 1}`,
          kind: draft.n > 0 ? "edit" : "build",
          spec,
        },
        modelId: coderModel,
        revision: { n: draft.n, source: draft.source },
        run,
        thinking,
      });
      builds.push(record);
      if (record.reason) {
        return { ok: false, reason: record.reason };
      }
      // The next Revision: the files the build left, as the Talker would write <n+1>/.
      draft.n += 1;
      draft.source = Object.fromEntries(
        SOURCE_FILES.filter((file) =>
          existsSync(path.join(buildDir, file))
        ).map((file) => [
          file,
          readFileSync(path.join(buildDir, file), "utf-8"),
        ])
      );
      return { ok: true, summary: record.summary };
    },
    dir,
    modelId: talkerModel,
    run,
  });
  return { builds, talker };
};
