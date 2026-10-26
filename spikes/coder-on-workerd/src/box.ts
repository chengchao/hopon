/* oxlint-disable complexity, no-await-in-loop, no-empty-function, no-promise-executor-return, no-void, promise/avoid-new, promise/prefer-await-to-callbacks, promise/prefer-await-to-then, promise/prefer-catch -- throwaway spike */
// The slice of E2B's `Sandbox` that apps/maker's runJob and ops.ts use, over the Durable Object Container API
// (ctx.container.exec). So the Coder's job code runs unchanged: commands.run (foreground, or background with streamed
// output, kill and wait) and files.read/write/exists/makeDir.
//
// exec() runs the executable with no shell, inherits no env but PATH, and has no timeout: commands go through
// `bash -lc`, the env is passed per call, and timeouts are an AbortSignal (abort = SIGKILL).
import type { Sandbox } from "e2b";

const USER = "1001:1001";
const ENV = {
  HOME: "/home/user",
  PLAYWRIGHT_BROWSERS_PATH: "/opt/hopon/browsers",
};

interface Result {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// E2B throws a CommandExitError with stdout, stderr and exitCode on a non-zero exit; box.ts `run` and ops.ts read it.
const exitError = (result: Result) =>
  Object.assign(new Error(`exit ${result.exitCode}`), result);

const pump = async (
  stream: ReadableStream | null,
  on?: (text: string) => void
) => {
  let all = "";
  if (!stream) {
    return all;
  }
  const decoder = new TextDecoder();
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    const text = decoder.decode(chunk, { stream: true });
    all += text;
    on?.(text);
  }
  return all;
};

export const execBox = (
  container: Container,
  log: (line: string) => void = () => {}
) => {
  const spawn = async (
    cmd: string[],
    opts: {
      cwd?: string;
      timeoutMs?: number;
      stdin?: ReadableStream;
      signal?: AbortSignal;
    } = {}
  ) => {
    const kill = new AbortController();
    const signals = [kill.signal, opts.signal].filter(Boolean) as AbortSignal[];
    if (opts.timeoutMs) {
      signals.push(AbortSignal.timeout(opts.timeoutMs));
    }
    const signal = AbortSignal.any(signals);
    const proc = await container.exec(cmd, {
      cwd: opts.cwd ?? "/workspace",
      env: ENV,
      signal,
      stderr: "pipe",
      stdin: opts.stdin,
      stdout: "pipe",
      user: USER,
    });
    const at = Date.now();
    const shown = cmd.join(" ").slice(0, 100);
    log(`spawn: ${shown}`);
    proc.exitCode.then(
      (code) => log(`exit ${code} after ${Date.now() - at}ms: ${shown}`),
      (error: unknown) => log(`exit error ${String(error)}: ${shown}`)
    );
    return { kill, proc, signal };
  };

  const run = (command: string, cwd?: string, timeoutMs?: number) =>
    spawn(["bash", "-lc", command], { cwd, timeoutMs });

  const finish = async (
    { proc, signal }: Awaited<ReturnType<typeof spawn>>,
    onStdout?: (text: string) => void,
    onStderr?: (text: string) => void
  ): Promise<Result> => {
    const [stdout, stderr, exitCode] = await Promise.all([
      pump(proc.stdout, onStdout),
      pump(proc.stderr, onStderr),
      proc.exitCode,
    ]);
    if (signal.aborted) {
      throw Object.assign(new Error(`killed: ${String(signal.reason)}`), {
        stderr,
        stdout,
      });
    }
    return { exitCode, stderr, stdout };
  };

  const commands = {
    run: async (
      command: string,
      opts: {
        cwd?: string;
        timeoutMs?: number;
        background?: boolean;
        onStdout?: (data: string) => void;
        onStderr?: (data: string) => void;
      } = {}
    ) => {
      const started = Date.now();
      log(`start: ${command.slice(0, 80)}`);
      const spawned = await run(command, opts.cwd, opts.timeoutMs || undefined);
      const done = finish(spawned, opts.onStdout, opts.onStderr).then(
        (result) => {
          log(
            `exec ${Date.now() - started}ms exit ${result.exitCode}: ${command.slice(0, 80)}`
          );
          if (result.exitCode !== 0) {
            throw exitError(result);
          }
          return result;
        }
      );
      if (!opts.background) {
        return await done;
      }
      // Kept from rejecting unobserved; wait() rethrows.
      done.catch(() => {});
      return {
        kill: () => {
          spawned.kill.abort("killed");
          return Promise.resolve(true);
        },
        wait: () => done,
      };
    },
  };

  const cat = async (file: string) => {
    const spawned = await spawn(["cat", file]);
    const [bytes, , exitCode] = await Promise.all([
      new Response(spawned.proc.stdout).arrayBuffer(),
      // Unread, stderr keeps the process from reporting its exit.
      pump(spawned.proc.stderr),
      spawned.proc.exitCode,
    ]);
    if (exitCode !== 0) {
      throw new Error(`${file} not found`);
    }
    return new Uint8Array(bytes);
  };

  const files = {
    exists: async (file: string) => {
      const { proc } = await spawn(["test", "-e", file]);
      return (await proc.exitCode) === 0;
    },
    makeDir: async (dir: string) => {
      const { proc } = await spawn(["mkdir", "-p", dir]);
      return (await proc.exitCode) === 0;
    },
    read: async (file: string, opts?: { format?: "text" | "bytes" }) => {
      const bytes = await cat(file);
      return opts?.format === "bytes" ? bytes : new TextDecoder().decode(bytes);
    },
    write: async (file: string, content: string | Uint8Array) => {
      const { proc } = await spawn(
        [
          "bash",
          "-c",
          'mkdir -p "$(dirname "$1")" && cat > "$1"',
          "write",
          file,
        ],
        { stdin: new Response(content).body ?? undefined }
      );
      const exitCode = await proc.exitCode;
      if (exitCode !== 0) {
        throw new Error(`write ${file}: exit ${exitCode}`);
      }
      return { path: file };
    },
  };

  return { commands, files } as unknown as Sandbox;
};

// A box with no container: files in a Map, every command exits 0 with no output. Tests pi's loop alone.
export const memoryBox = (log: (line: string) => void = () => {}) => {
  const store = new Map<string, Uint8Array>();
  const ok = { exitCode: 0, stderr: "", stdout: "" };
  return {
    commands: {
      run: (command: string, opts: { background?: boolean } = {}) => {
        log(`fake exec: ${command.slice(0, 80)}`);
        return Promise.resolve(
          opts.background
            ? {
                kill: () => Promise.resolve(true),
                wait: () => Promise.resolve(ok),
              }
            : ok
        );
      },
    },
    files: {
      exists: (file: string) => Promise.resolve(store.has(file)),
      makeDir: () => Promise.resolve(true),
      read: (file: string, opts?: { format?: string }) => {
        const bytes = store.get(file);
        if (!bytes) {
          return Promise.reject(new Error(`${file} not found`));
        }
        return Promise.resolve(
          opts?.format === "bytes" ? bytes : new TextDecoder().decode(bytes)
        );
      },
      write: (file: string, content: string) => {
        store.set(file, new TextEncoder().encode(content));
        return Promise.resolve({ path: file });
      },
    },
  } as unknown as Sandbox;
};
