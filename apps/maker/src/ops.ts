// pi's built-in read, bash, edit and write, executing in the Coder's E2B box. Each tool accepts `operations` (its file
// system / process primitives); these implement them over the E2B SDK, so pi itself and the model key stay here.
import { readFile as localReadFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import {
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
  BashOperations,
  ToolDefinition,
  ToolsOptions,
} from "@earendil-works/pi-coding-agent";
import type { Sandbox } from "e2b";

const MIME_BY_EXTENSION: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const SIGKILL_EXIT = 137;
const EXISTS_RETRY_MS = 300;

const imageMimeType = (file: string) =>
  Object.entries(MIME_BY_EXTENSION).find(([ext]) => file.endsWith(ext))?.[1] ??
  null;

const exitCodeOf = (error: unknown) =>
  error && typeof error === "object" && "exitCode" in error
    ? (error as { exitCode: number }).exitCode
    : null;

export interface OpsToolsOptions {
  sandbox: Sandbox;
  // Paths under these local directories (pi's skills) read from this machine, everything else from the box.
  localRoots: string[];
}

// Runs a shell command in the box, streaming output. Honors pi's abort signal and timeout; ignores pi's env (the
// Maker's environment must not reach the box).
export const createE2BBashOperations = (sandbox: Sandbox): BashOperations => ({
  exec: async (command, cwd, { onData, signal, timeout }) => {
    if (signal?.aborted) {
      throw new Error("aborted");
    }
    const handle = await sandbox.commands.run(command, {
      background: true,
      cwd,
      onStderr: (data) => onData(Buffer.from(data)),
      onStdout: (data) => onData(Buffer.from(data)),
      timeoutMs: timeout ?? 0,
    });
    const kill = async () => {
      try {
        await handle.kill();
      } catch {
        // Already gone.
      }
    };
    signal?.addEventListener("abort", kill, { once: true });
    try {
      const result = await handle.wait();
      return { exitCode: result.exitCode };
    } catch (error) {
      const exitCode = exitCodeOf(error);
      if (exitCode !== null) {
        return { exitCode };
      }
      // Killed (abort or E2B timeout): the SDK reports no exit code.
      if (signal?.aborted || /timeout|killed/iu.test(String(error))) {
        return { exitCode: SIGKILL_EXIT };
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", kill);
    }
  },
});

// oxlint-disable-next-line no-explicit-any -- pi's own ToolDef is ToolDefinition<any, any>
export type ToolDef = ToolDefinition<any, any>;

// read, bash, edit and write with every operation in the box.
export const createE2BTools = (
  cwd: string,
  { sandbox, localRoots }: OpsToolsOptions
): ToolDef[] => {
  const { files } = sandbox;
  const isLocal = (file: string) =>
    localRoots.some((root) => file.startsWith(`${root}/`));
  const readFile = async (file: string) =>
    isLocal(file)
      ? localReadFile(file)
      : Buffer.from(await files.read(file, { format: "bytes" }));
  const access = async (file: string) => {
    if (isLocal(file)) {
      await localReadFile(file);
      return;
    }
    // ponytail: in 2 of 5 eval runs, stat said playtest.png was missing right after the bash command that wrote
    // it had exited, and found it a moment later. One retry covers that; not reproduced outside a model run.
    if (await files.exists(file)) {
      return;
    }
    await sleep(EXISTS_RETRY_MS);
    if (!(await files.exists(file))) {
      throw new Error(`${file} not found`);
    }
  };
  const writeFile = async (file: string, content: string) => {
    await files.write(file, content);
  };
  const options: ToolsOptions = {
    bash: {
      exposeSessionEnvironment: false,
      operations: createE2BBashOperations(sandbox),
    },
    edit: { operations: { access, readFile, writeFile } },
    read: {
      operations: {
        access,
        detectImageMimeType: (file) => Promise.resolve(imageMimeType(file)),
        readFile,
      },
    },
    write: {
      operations: {
        mkdir: async (dir) => {
          await files.makeDir(dir);
        },
        writeFile,
      },
    },
  };
  return [
    createReadToolDefinition(cwd, options.read),
    createBashToolDefinition(cwd, options.bash),
    createEditToolDefinition(cwd, options.edit),
    createWriteToolDefinition(cwd, options.write),
  ];
};
