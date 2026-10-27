// The Coder's box (#175): a Cloudflare Container the Coder starts and drives itself through `ctx.container`, under the
// `durable_object` policy, with no internet and no secrets. All the Coder does in it goes through `BoxEdge`, so the
// contract test fakes the box there (test/coder/worker.ts). pi's tools reach it through boxEnv, an ExecutionEnv, and
// the game rules (apps/maker/src/job.ts) through jobBox.
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

import { WORKSPACE } from "../../maker/src/job.ts";
import type { Box } from "../../maker/src/job.ts";

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
// No command a job runs (a playtest, the music render) should take longer; pi's bash passes its own.
const COMMAND_TIMEOUT_S = 120;

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

// What the Coder needs of its box.
export interface BoxEdge {
  readonly running: boolean;
  // Resolves once the box answers exec(); throws when it can't start.
  start: () => Promise<void>;
  // The box stops BOX_IDLE_MS after its last activity. Set at start(), and again when the Coder restarts, since the
  // timeout doesn't outlive the object.
  setInactivityTimeout: () => Promise<void>;
  destroy: () => Promise<void>;
  // One process, both streams read to the end.
  exec: (argv: string[], options?: ExecOptions) => Promise<Exec>;
  files: Pick<
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
}

// Every command as `timeout`'s child, which ends it and every process it started, at its time or on an abort.
const timed = (seconds: number, argv: string[]) => [
  "timeout",
  "--kill-after=5",
  String(seconds),
  ...argv,
];

const drain = async (
  stream: ReadableStream | null,
  name: "stdout" | "stderr",
  onOutput?: ExecOptions["onOutput"]
) => {
  const chunks: Uint8Array[] = [];
  if (!stream) {
    return new Uint8Array();
  }
  const decoder = new TextDecoder();
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
    onOutput?.(decoder.decode(chunk, { stream: true }), name);
  }
  return new Uint8Array(await new Blob(chunks).arrayBuffer());
};

// Plain `wrangler dev` and the tests' getPlatformProxy run without containers: a build there fails saying so.
export class NoBoxError extends Error {
  override name = "NoBoxError";
  constructor() {
    super("no box here: run `pnpm -F worker dev:coder`, with Docker");
  }
}

export const containerBox = (maybe: Container | undefined): BoxEdge => {
  const container = () => {
    if (!maybe) {
      throw new NoBoxError();
    }
    return maybe;
  };
  const exec: BoxEdge["exec"] = async (argv, options = {}) => {
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
    // 5 s on. exec()'s own signal would SIGKILL `timeout` alone and leave the rest running.
    const term = () => proc.kill(15);
    signal?.addEventListener("abort", term, { once: true });
    // An unread stream keeps the process from reporting its exit.
    const [stdout, stderr, exitCode] = await Promise.all([
      drain(proc.stdout, "stdout", options.onOutput),
      drain(proc.stderr, "stderr", options.onOutput),
      proc.exitCode,
    ]).finally(() => signal?.removeEventListener("abort", term));
    return { exitCode, stderr: new TextDecoder().decode(stderr), stdout };
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
  const setInactivityTimeout = () =>
    container().setInactivityTimeout(BOX_IDLE_MS);
  return {
    destroy: () => container().destroy(),
    exec,
    files: new Files({
      exec: (argv, options) => container().exec(argv, options),
    }),
    get running() {
      return maybe?.running ?? false;
    },
    setInactivityTimeout,
    // Ready at the first exec() that answers: the entrypoint starts Chromium in the background, and the playtest
    // launches its own if it isn't up yet.
    // Production's box is a durable_object-policy app, so start() names its image and size. A Preview's can only be a
    // default-policy app (wrangler.jsonc), whose image and size are its config's.
    start: async () => {
      const { images } = container();
      container().start(
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
        await sleep(100);
      }
      await setInactivityTimeout();
    },
  };
};

const as = { user: USER };
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
const DONE: Result<void, FileError> = { ok: true, value: undefined };
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

const readBytes = async (files: BoxEdge["files"], file: string) => {
  const response = await files.readFile(file, as);
  return new Uint8Array(await response.arrayBuffer());
};
const readText = async (files: BoxEdge["files"], file: string) => {
  const response = await files.readFile(file, as);
  return await response.text();
};

// pi-durable's ExecutionEnv over the box: what CodingTools (read, write, edit, bash) call, through Files where it has
// the operation and exec() for the rest (realpath, append, truncate).
export const boxEnv = (box: BoxEdge, id: string): ExecutionEnv => {
  const { files } = box;
  const read = (p: string) => attempt(p, () => readBytes(files, resolve(p)));
  const fileInfo = (p: string) =>
    attempt(p, async () => info(p, await files.stat(resolve(p), as)));
  const command = async (argv: string[], p: string, stdin?: ReadableStream) => {
    const result = await box.exec(timed(COMMAND_TIMEOUT_S, argv), { stdin });
    return result.exitCode === 0
      ? ok<string, FileError>(new TextDecoder().decode(result.stdout))
      : err<string, FileError>(
          new FileError(
            /No such file/iu.test(result.stderr) ? "not_found" : "unknown",
            result.stderr.trim() || `${argv[0]} failed: ${p}`,
            p
          )
        );
  };
  const done = async (
    pending: ReturnType<typeof command>
  ): Promise<Result<void, FileError>> => {
    const result = await pending;
    return result.ok ? DONE : err(result.error);
  };
  return {
    absolutePath: (p) => Promise.resolve(ok(resolve(p))),
    appendFile: (p, content) =>
      done(
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
          ...as,
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
        const result = await box.exec(timed(seconds, argv), {
          cwd: options?.cwd ? resolve(options.cwd) : WORKSPACE,
          onOutput: (text, stream) =>
            options?.onOutput?.(text, context, { stream }),
          signal: context.abortSignal,
        });
        if (context.abortSignal?.aborted) {
          return err(new ExecutionError("aborted", "aborted"));
        }
        // GNU timeout exits 124 when the time ran out, 137 when it had to SIGKILL.
        if (result.exitCode === 124 || result.exitCode === 137) {
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
    flushFile: () => Promise.resolve(DONE),
    id,
    joinPath: (parts) => Promise.resolve(ok(path.posix.join(...parts))),
    listDir: (p) =>
      attempt(p, async () => {
        const entries = await files.readDirectory(resolve(p), as);
        return await Promise.all(
          entries.map(async (entry) => {
            const child = path.posix.join(resolve(p), entry.name);
            return info(child, await files.lstat(child, as));
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
          ...as,
          force: options?.force ?? false,
          recursive: options?.recursive ?? false,
        })
      ),
    renameFile: (from, to) =>
      attempt(from, () => files.rename(resolve(from), resolve(to), as)),
    truncateFile: (p, size) =>
      done(command(["truncate", "-s", String(size), "--", resolve(p)], p)),
    watch: unsupported("watch"),
    // pi's write makes the parent directory, as Files' writeFile doesn't.
    writeFile: (p, content) =>
      attempt(p, async () => {
        await files.mkdir(path.posix.dirname(resolve(p)), {
          ...as,
          recursive: true,
        });
        await files.writeFile(resolve(p), content, as);
      }),
  };
};

// The game rules' Box: commands in the workspace under the command timeout, their output whatever the exit code.
export const jobBox = (box: BoxEdge): Box => ({
  read: (file) => readText(box.files, file),
  readBytes: (file) => readBytes(box.files, file),
  run: async (command) => {
    const result = await box.exec(
      timed(COMMAND_TIMEOUT_S, ["bash", "-lc", command])
    );
    return { ...result, stdout: new TextDecoder().decode(result.stdout) };
  },
  write: async (file, text) => {
    await box.files.mkdir(path.posix.dirname(file), { ...as, recursive: true });
    await box.files.writeFile(file, text, as);
  },
});
