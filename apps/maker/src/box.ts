// The Coder's box: an E2B sandbox from the template image/build.ts makes, with no egress and no secrets.
import { Sandbox } from "e2b";

export const E2B_TEMPLATE = "hopon-maker-eval";
export const WORKSPACE = "/workspace";

export const createBox = () =>
  Sandbox.create(E2B_TEMPLATE, {
    allowInternetAccess: false,
    // A job's own deadline is 4½ minutes; this only reaps a box whose process died.
    timeoutMs: 600_000,
  });

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
