// The Coder's box: an E2B sandbox from the template image/build.ts makes, with no egress and no secrets. The Container
// keeps one per Draft, found by its `draftId` metadata, and pauses it between jobs; the eval makes a fresh one per run.
import { Sandbox, SandboxNotFoundError } from "e2b";

import { WORKSPACE } from "./rules.ts";
import type { Box } from "./rules.ts";

// The Worker's MAKER_E2B_TEMPLATE var (Previews have their own), passed to the Container; image/build.ts builds the same.
export const E2B_TEMPLATE = process.env.MAKER_E2B_TEMPLATE ?? "hopon-maker";
export const EVAL_TEMPLATE = "hopon-maker-eval";
// A job's own deadline is 2½ minutes at most; this only reaps a box whose Coder died before pausing it.
const BOX_TIMEOUT_MS = 600_000;

export const createBox = (
  template: string,
  metadata?: Record<string, string>
) =>
  Sandbox.create(template, {
    allowInternetAccess: false,
    metadata,
    timeoutMs: BOX_TIMEOUT_MS,
  });

const draftBoxes = async (draftId: string) =>
  await Sandbox.list({ query: { metadata: { draftId } } }).nextItems();

// The Draft's box, resumed if it is paused, or a new one. Just after a kill, E2B still lists the killed box (seen
// 2026-10-23), so a listed box that is gone is skipped.
export const openBox = async (draftId: string) => {
  for (const box of await draftBoxes(draftId)) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- the first box that connects; connecting resumes it
      return await Sandbox.connect(box.sandboxId, {
        timeoutMs: BOX_TIMEOUT_MS,
      });
    } catch (error) {
      if (!(error instanceof SandboxNotFoundError)) {
        throw error;
      }
    }
  }
  return await createBox(E2B_TEMPLATE, { draftId });
};

export const killBox = async (draftId: string) => {
  const boxes = await draftBoxes(draftId);
  await Promise.all(boxes.map((box) => Sandbox.kill(box.sandboxId)));
};

// The sandbox as the game rules' Box. A command's output comes back whatever its exit code.
export const ruleBox = (sandbox: Sandbox): Box => ({
  read: async (file) => await sandbox.files.read(file),
  readBytes: async (file) =>
    await sandbox.files.read(file, { format: "bytes" }),
  run: async (command) =>
    await sandbox.commands
      .run(command, { cwd: WORKSPACE, timeoutMs: 120_000 })
      .catch((error: unknown) => {
        if (error && typeof error === "object" && "exitCode" in error) {
          return error as { stdout: string; stderr: string; exitCode: number };
        }
        throw error;
      }),
  write: async (file, text) => {
    await sandbox.files.write(file, text);
  },
});
