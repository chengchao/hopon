// The Coder's box: an E2B sandbox from the template image/build.ts makes, with no egress and no secrets. The Container
// keeps one per Draft, found by its `draftId` metadata, and pauses it between jobs; the eval makes a fresh one per run.
import { Sandbox, SandboxNotFoundError } from "e2b";

export const E2B_TEMPLATE = "hopon-maker";
export const EVAL_TEMPLATE = "hopon-maker-eval";
export const WORKSPACE = "/workspace";
// A job's own deadline is 2½ minutes at most; this only reaps a box whose Coder died before pausing it.
const BOX_TIMEOUT_MS = 600_000;

export const createBox = (
  template: typeof E2B_TEMPLATE | typeof EVAL_TEMPLATE,
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

// Runs a command in the workspace and returns its output whatever the exit code.
export const run = async (
  sandbox: Sandbox,
  command: string,
  timeoutMs = 120_000
) =>
  await sandbox.commands
    .run(command, { cwd: WORKSPACE, timeoutMs })
    .catch((error: unknown) => {
      if (error && typeof error === "object" && "exitCode" in error) {
        return error as { stdout: string; stderr: string; exitCode: number };
      }
      throw error;
    });
