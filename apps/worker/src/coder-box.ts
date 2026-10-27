// The Coder's box (#175): a Cloudflare Container the Coder starts and drives itself through `ctx.container`, under the
// `durable_object` policy, with no internet and no secrets. All the Coder does in it goes through the `Box` service, so
// the contract test swaps its Layer for a fake (test/coder/worker.ts). pi's tools reach it through boxEnv, an
// ExecutionEnv, and the game rules (apps/maker/src/job.ts) through jobBox.
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { Files, SandboxFileError } from "@cloudflare/sandbox";
import {
  err,
  ExecutionError,
  FileError,
  LineScanner,
  ok,
} from "@earendil-works/pi-durable/env";
import type {
  ExecutionEnv,
  FileErrorCode,
  FileInfo,
  Result,
} from "@earendil-works/pi-durable/env";
import { Context, Data, Effect, Layer } from "effect";

import { WORKSPACE } from "../../maker/src/job.ts";
import type { Box as JobBox } from "../../maker/src/job.ts";

// The image's unprivileged user (apps/maker/image/Dockerfile). exec() inherits only PATH, so each call passes the rest.
const USER = "1001:1001";
const BOX_ENV = {
  HOME: "/home/user",
  PLAYWRIGHT_BROWSERS_PATH: "/opt/hopon/browsers",
};
// The size the spike measured (docs/research/coder-on-workerd.md).
const INSTANCE = { diskMb: 6000, memoryMib: 6144, vcpu: 2 };
// A box stops this long after the Coder's last activity; the next job cold-starts one.
const BOX_IDLE_MS = 300_000;
// A cold box answers exec() in 0.2–0.5 s, a first boot on a new host in up to 21 s.
const READY_MS = 60_000;
const READY_POLL_MS = 100;
// No command a job runs (a playtest, the music render) should take longer; pi's bash passes its own.
const COMMAND_TIMEOUT_S = 120;
// How long `timeout` waits after its SIGTERM before it SIGKILLs what's left.
const KILL_AFTER_S = 5;
const SIGTERM = 15;
// GNU timeout's exit codes: the time ran out, or it had to SIGKILL.
const TIMED_OUT = 124;
const KILLED = 137;

export interface Exec {
  exitCode: number;
  stdout: Uint8Array;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  stdin?: ReadableStream;
  signal?: AbortSignal;
  onOutput?: (text: string, stream: "stdout" | "stderr") => void;
}

export type BoxFiles = Pick<
  Files,
  | "readFile"
  | "writeFile"
  | "stat"
  | "lstat"
  | "readDirectory"
  | "mkdir"
  | "rename"
  | "remove"
>;

// What a job does in the box: run a command (one process, both streams read to the end), and its files. Promises,
// since pi's ExecutionEnv and job.ts's Box, their only callers, are promise interfaces.
export interface BoxOps {
  exec: (argv: string[], options?: ExecOptions) => Promise<Exec>;
  files: BoxFiles;
}

// Plain `wrangler dev` and the tests' getPlatformProxy run without containers.
export class NoBox extends Data.TaggedError("NoBox") {
  override readonly message =
    "no box here: run `pnpm -F worker dev:coder`, with Docker";
}

// The platform refused to start the box, or it didn't answer in READY_MS.
export class BoxStartFailed extends Data.TaggedError("BoxStartFailed")<{
  readonly cause: unknown;
}> {}

// The box at the Coder's edge.
export class Box extends Context.Service<
  Box,
  BoxOps & {
    readonly running: Effect.Effect<boolean>;
    // Done once the box answers exec().
    readonly start: Effect.Effect<void, NoBox | BoxStartFailed>;
    // The box stops BOX_IDLE_MS after its last activity. Set at start, and again when the Coder restarts, since the
    // timeout doesn't outlive the object.
    readonly keepAlive: Effect.Effect<void>;
    readonly destroy: Effect.Effect<void>;
  }
>()("hopon/worker/Box") {}

// Every command as `timeout`'s child, which ends it and every process it started, at its time or on an abort.
const timed = (argv: string[], seconds = COMMAND_TIMEOUT_S) => [
  "timeout",
  `--kill-after=${KILL_AFTER_S}`,
  String(seconds),
  ...argv,
];

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

const drain = async (
  stream: ReadableStream<Uint8Array> | null,
  name: "stdout" | "stderr",
  onOutput?: ExecOptions["onOutput"]
) => {
  const chunks: Uint8Array[] = [];
  if (!stream) {
    return new Uint8Array();
  }
  const decoder = new TextDecoder();
  await stream.pipeTo(
    new WritableStream({
      write: (chunk) => {
        chunks.push(chunk);
        onOutput?.(decoder.decode(chunk, { stream: true }), name);
      },
    })
  );
  return new Uint8Array(await new Blob(chunks).arrayBuffer());
};

export const containerBox = (maybe: Container | undefined) => {
  const container = () => {
    if (!maybe) {
      throw new NoBox();
    }
    return maybe;
  };
  const exec: BoxOps["exec"] = async (argv, options = {}) => {
    const { signal } = options;
    signal?.throwIfAborted();
    const proc = await container().exec(argv, {
      cwd: options.cwd ?? WORKSPACE,
      env: BOX_ENV,
      stderr: "pipe",
      stdin: options.stdin,
      stdout: "pipe",
      user: USER,
    });
    // An abort sends SIGTERM to `timeout`, which passes it to every process the command started, then SIGKILLs them
    // KILL_AFTER_S on. exec()'s own signal would SIGKILL `timeout` alone and leave the rest running.
    const term = () => proc.kill(SIGTERM);
    signal?.addEventListener("abort", term, { once: true });
    // An unread stream keeps the process from reporting its exit.
    const [stdout, stderr, exitCode] = await Promise.all([
      drain(proc.stdout, "stdout", options.onOutput),
      drain(proc.stderr, "stderr", options.onOutput),
      proc.exitCode,
    ]).finally(() => signal?.removeEventListener("abort", term));
    return { exitCode, stderr: decode(stderr), stdout };
  };
  // Up once an exec() answers.
  const answers = async () => {
    try {
      const proc = await container().exec(["true"], {
        stderr: "ignore",
        stdout: "ignore",
      });
      return (await proc.exitCode) === 0;
    } catch {
      return false;
    }
  };
  const keepAlive = Effect.promise(() =>
    container().setInactivityTimeout(BOX_IDLE_MS)
  );
  // Ready at the first exec() that answers: the entrypoint starts Chromium in the background, and the playtest
  // launches its own if it isn't up yet.
  // Production's box is a durable_object-policy app, so start names its image and size. A Preview's can only be a
  // default-policy app (wrangler.jsonc), whose image and size are its config's.
  const start = Effect.gen(function* () {
    if (!maybe) {
      return yield* new NoBox();
    }
    const { images } = maybe;
    yield* Effect.tryPromise({
      catch: (cause) => new BoxStartFailed({ cause }),
      try: async () => {
        maybe.start(
          images.box
            ? { enableInternet: false, image: images.box, instance: INSTANCE }
            : { enableInternet: false }
        );
        const startedAt = Date.now();
        // oxlint-disable-next-line no-await-in-loop -- polling until the box answers
        while (!(await answers())) {
          if (Date.now() - startedAt > READY_MS) {
            throw new Error(`the box didn't answer in ${READY_MS / 1000} s`);
          }
          // oxlint-disable-next-line no-await-in-loop -- polling until the box answers
          await sleep(READY_POLL_MS);
        }
      },
    });
    yield* keepAlive;
  });
  return Layer.succeed(Box, {
    destroy: Effect.promise(() => container().destroy()),
    exec,
    files: new Files({
      exec: (argv, options) => container().exec(argv, options),
    }),
    keepAlive,
    running: Effect.sync(() => maybe?.running ?? false),
    start,
  });
};

// The box's commands and files, each after `ready` (the Coder's: start a box that stopped, and restore its job).
export const readyFirst = (box: BoxOps, ready: () => Promise<void>): BoxOps => {
  const after =
    <A extends unknown[], R>(op: (...args: A) => Promise<R>) =>
    async (...args: A) => {
      await ready();
      return await op(...args);
    };
  const { files } = box;
  return {
    exec: after(box.exec),
    files: {
      lstat: after(files.lstat.bind(files)),
      mkdir: after(files.mkdir.bind(files)),
      readDirectory: after(files.readDirectory.bind(files)),
      readFile: after(files.readFile.bind(files)),
      remove: after(files.remove.bind(files)),
      rename: after(files.rename.bind(files)),
      stat: after(files.stat.bind(files)),
      writeFile: after(files.writeFile.bind(files)),
    },
  };
};

const asUser = { user: USER };
const resolve = (p: string) => path.posix.resolve(WORKSPACE, p);

// Files' typed errors as pi-durable's.
const FILE_ERRORS: Record<string, FileErrorCode> = {
  EACCES: "permission_denied",
  EINVAL: "invalid",
  EISDIR: "is_directory",
  ENOENT: "not_found",
  ENOTDIR: "not_directory",
  EPERM: "permission_denied",
};
const fileError = (error: unknown, p: string) =>
  new FileError(
    SandboxFileError.is(error)
      ? (FILE_ERRORS[error.code] ?? "unknown")
      : "unknown",
    error instanceof Error ? error.message : String(error),
    p
  );
const attempt = async <T>(p: string, run: () => Promise<T>) => {
  try {
    return ok<T, FileError>(await run());
  } catch (error) {
    return err<T, FileError>(fileError(error, p));
  }
};
// A file operation's success with no value.
const OK: Result<void, FileError> = { ok: true, value: undefined };
const unsupported = (name: string) => () =>
  Promise.resolve(
    err<never, FileError>(
      new FileError("not_supported", `${name} is not supported in the box`)
    )
  );

const KINDS: Record<string, FileInfo["kind"]> = {
  directory: "directory",
  symlink: "symlink",
};
const info = (
  p: string,
  stat: { type: string; size: bigint; modifiedAt: Date }
): FileInfo => ({
  kind: KINDS[stat.type] ?? "file",
  mtimeMs: stat.modifiedAt.getTime(),
  name: path.posix.basename(p),
  path: resolve(p),
  size: Number(stat.size),
});

const readBytes = async (files: BoxFiles, file: string) => {
  const response = await files.readFile(file, asUser);
  return new Uint8Array(await response.arrayBuffer());
};
const readText = async (files: BoxFiles, file: string) => {
  const response = await files.readFile(file, asUser);
  return await response.text();
};
// With its parent directory, which Files' writeFile doesn't make.
const write = async (
  files: BoxFiles,
  file: string,
  content: Parameters<BoxFiles["writeFile"]>[1]
) => {
  await files.mkdir(path.posix.dirname(file), { ...asUser, recursive: true });
  await files.writeFile(file, content, asUser);
};

// pi-durable's ExecutionEnv over the box: what CodingTools (read, write, edit, bash) call, through Files where it has
// the operation and exec() for the rest (realpath, append, truncate).
export const boxEnv = (box: BoxOps, id: string): ExecutionEnv => {
  const { files } = box;
  const read = (p: string) => attempt(p, () => readBytes(files, resolve(p)));
  const fileInfo = (p: string) =>
    attempt(p, async () => info(p, await files.stat(resolve(p), asUser)));
  const command = async (argv: string[], p: string, stdin?: ReadableStream) => {
    const result = await box.exec(timed(argv), { stdin });
    return result.exitCode === 0
      ? ok<string, FileError>(decode(result.stdout))
      : err<string, FileError>(
          new FileError(
            /No such file/iu.test(result.stderr) ? "not_found" : "unknown",
            result.stderr.trim() || `${argv[0]} failed: ${p}`,
            p
          )
        );
  };
  const withoutValue = async (
    pending: ReturnType<typeof command>
  ): Promise<Result<void, FileError>> => {
    const result = await pending;
    return result.ok ? OK : err(result.error);
  };
  return {
    absolutePath: (p) => Promise.resolve(ok(resolve(p))),
    appendFile: (p, content) =>
      withoutValue(
        command(
          ["bash", "-c", 'cat >> "$1"', "append", resolve(p)],
          p,
          new Response(content).body ?? undefined
        )
      ),
    canonicalPath: async (p) => {
      const result = await command(["realpath", "-m", "--", resolve(p)], p);
      return result.ok ? ok(result.value.trim()) : result;
    },
    cleanup: () => Promise.resolve(),
    createDir: (p, options) =>
      attempt(p, () =>
        files.mkdir(resolve(p), {
          ...asUser,
          recursive: options?.recursive ?? false,
        })
      ),
    createTempDir: unsupported("createTempDir"),
    createTempFile: unsupported("createTempFile"),
    cwd: WORKSPACE,
    exec: async (cmd, options, context) => {
      const argv = typeof cmd === "string" ? ["bash", "-lc", cmd] : [...cmd];
      const seconds = options?.timeout ?? COMMAND_TIMEOUT_S;
      try {
        const result = await box.exec(timed(argv, seconds), {
          cwd: options?.cwd ? resolve(options.cwd) : WORKSPACE,
          onOutput: (text, stream) =>
            options?.onOutput?.(text, context, { stream }),
          signal: context.abortSignal,
        });
        if (context.abortSignal?.aborted) {
          return err(new ExecutionError("aborted", "aborted"));
        }
        if (result.exitCode === TIMED_OUT || result.exitCode === KILLED) {
          return err(
            new ExecutionError("timeout", `timed out after ${seconds} s`)
          );
        }
        return ok({ exitCode: result.exitCode });
      } catch (error) {
        return err(
          new ExecutionError(
            context.abortSignal?.aborted ? "aborted" : "spawn_error",
            String(error)
          )
        );
      }
    },
    exists: async (p) => {
      const found = await fileInfo(p);
      if (found.ok) {
        return ok(true);
      }
      return found.error.code === "not_found" ? ok(false) : found;
    },
    fileInfo,
    flushFile: () => Promise.resolve(OK),
    id,
    joinPath: (parts) => Promise.resolve(ok(path.posix.join(...parts))),
    listDir: (p) =>
      attempt(p, async () => {
        const entries = await files.readDirectory(resolve(p), asUser);
        return await Promise.all(
          entries.map(async (entry) => {
            const child = path.posix.join(resolve(p), entry.name);
            return info(child, await files.lstat(child, asUser));
          })
        );
      }),
    openBinaryReader: async (p) => {
      const found = await fileInfo(p);
      if (!found.ok) {
        return found;
      }
      if (found.value.kind === "directory") {
        return err(new FileError("is_directory", `${p} is a directory`, p));
      }
      const bytes = await read(p);
      if (!bytes.ok) {
        return bytes;
      }
      // ponytail: the whole file is read once and served from memory; a game's files are a few KB.
      return ok({
        close: () => Promise.resolve(),
        info: () => Promise.resolve(found),
        read: (offset, length) =>
          Promise.resolve(ok(bytes.value.subarray(offset, offset + length))),
        scanLines: (options) => {
          const scanner = new LineScanner(options.startLine, options.endLine);
          scanner.push(bytes.value);
          return Promise.resolve(ok(scanner.finish()));
        },
      });
    },
    openDirReader: unsupported("openDirReader"),
    openTextLineReader: unsupported("openTextLineReader"),
    readBinaryFile: read,
    readTextFile: (p) => attempt(p, () => readText(files, resolve(p))),
    readTextLines: (p, options) =>
      attempt(p, async () => {
        const content = await readText(files, resolve(p));
        return content.split("\n").slice(0, options?.maxLines);
      }),
    remove: (p, options) =>
      attempt(p, () =>
        files.remove(resolve(p), {
          ...asUser,
          force: options?.force ?? false,
          recursive: options?.recursive ?? false,
        })
      ),
    renameFile: (from, to) =>
      attempt(from, () => files.rename(resolve(from), resolve(to), asUser)),
    truncateFile: (p, size) =>
      withoutValue(
        command(["truncate", "-s", String(size), "--", resolve(p)], p)
      ),
    watch: unsupported("watch"),
    // pi's write makes the parent directory.
    writeFile: (p, content) =>
      attempt(p, () => write(files, resolve(p), content)),
  };
};

// The game rules' Box: commands in the workspace under the command timeout, their output whatever the exit code.
export const jobBox = (box: BoxOps): JobBox => ({
  read: (file) => readText(box.files, file),
  readBytes: (file) => readBytes(box.files, file),
  run: async (command) => {
    const result = await box.exec(timed(["bash", "-lc", command]));
    return { ...result, stdout: decode(result.stdout) };
  },
  write: (file, text) => write(box.files, file, text),
});
