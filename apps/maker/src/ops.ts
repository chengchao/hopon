// pi's built-in tools, executing in a Box. Each tool accepts `operations` (its file system / process primitives);
// these implement them over the E2B SDK so pi's read, bash, edit, write, find and ls run in the sandbox while pi
// itself (and the model key) stays here. grep is the exception: pi's grep spawns ripgrep locally and only its
// context reads go through operations, so grep is a small tool of our own that runs rg in the box.
import { readFile as localReadFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import { Type } from "@earendil-works/pi-ai";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  defineTool,
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

const quote = (text: string) => `'${text.replaceAll("'", String.raw`'\''`)}'`;

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

// A grep that runs ripgrep in the box (the template has it; falls back to grep -rn).
const createBoxGrepTool = (sandbox: Sandbox, cwd: string) =>
  defineTool({
    description:
      "Search file contents for a regex pattern. Returns matching lines as path:line:text.",
    execute: async (_id, { pattern, path }) => {
      const target = quote(path ?? ".");
      const result = await sandbox.commands
        .run(
          `if command -v rg >/dev/null; then rg -n --no-heading ${quote(pattern)} ${target}; else grep -rn ${quote(pattern)} ${target}; fi`,
          { cwd }
        )
        .catch((error: unknown) => {
          if (exitCodeOf(error) === 1) {
            return { stdout: "No matches" };
          }
          throw error;
        });
      return {
        content: [{ text: result.stdout || "No matches", type: "text" }],
        details: undefined,
      };
    },
    label: "grep",
    name: "grep",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "File or directory" })),
      pattern: Type.String(),
    }),
    promptSnippet: "Search file contents for patterns",
  });

// The package exports each tool's factory but not createCodingToolDefinitions; same set, same order.
// oxlint-disable-next-line no-explicit-any -- pi's own ToolDef is ToolDefinition<any, any>
export type ToolDef = ToolDefinition<any, any>;

export const createCodingTools = (
  cwd: string,
  options: ToolsOptions
): ToolDef[] => [
  createReadToolDefinition(cwd, options.read),
  createBashToolDefinition(cwd, options.bash),
  createEditToolDefinition(cwd, options.edit),
  createWriteToolDefinition(cwd, options.write),
  createFindToolDefinition(cwd, options.find),
  createLsToolDefinition(cwd, options.ls),
];

// pi's coding tool set (read, bash, edit, write, grep, find, ls) with every operation in the box.
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
  // ls stats every entry; one list() answers all of them.
  const types = new Map<string, boolean>();
  const options: ToolsOptions = {
    bash: {
      exposeSessionEnvironment: false,
      operations: createE2BBashOperations(sandbox),
    },
    edit: { operations: { access, readFile, writeFile } },
    find: {
      operations: {
        exists: (file) => files.exists(file),
        glob: async (pattern, dir, { limit }) => {
          const result = await sandbox.commands
            .run(
              `if command -v fd >/dev/null; then fd --glob --hidden -E node_modules -E .git ${quote(pattern)} ${quote(dir)}; else find ${quote(dir)} -name ${quote(pattern)}; fi | head -n ${limit}`,
              { cwd }
            )
            .catch((error: unknown) => {
              if (exitCodeOf(error) === 1) {
                return { stdout: "" };
              }
              throw error;
            });
          return result.stdout.split("\n").filter(Boolean);
        },
      },
    },
    ls: {
      operations: {
        exists: (file) => files.exists(file),
        readdir: async (dir) => {
          const entries = await files.list(dir);
          for (const entry of entries) {
            types.set(entry.path, entry.type === "dir");
          }
          return entries.map((entry) => entry.name);
        },
        stat: async (file) => {
          const cached = types.get(file);
          if (cached !== undefined) {
            return { isDirectory: () => cached };
          }
          const info = await files.getInfo(file);
          return { isDirectory: () => info.type === "dir" };
        },
      },
    },
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
  return [...createCodingTools(cwd, options), createBoxGrepTool(sandbox, cwd)];
};
