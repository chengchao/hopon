// A Box runs model-written code next to a Draft's files. LocalBox is a temp dir on this machine (spike only: no
// isolation); E2BBox is a per-Draft E2B sandbox built from image/ with no secrets and no egress.
import { execFile } from "node:child_process";
import type { ExecFileException } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { Sandbox } from "e2b";

import { buildRuntime, RUNTIME_PATH } from "./runtime.ts";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  // Workspace files changed by the run.
  files: string[];
}

export interface Box {
  // The workspace directory, as the box sees it.
  cwd: string;
  run: (code: string, options?: { timeoutMs?: number }) => Promise<RunResult>;
  writeFile: (file: string, content: string | Uint8Array) => Promise<void>;
  readFile: (file: string) => Promise<Uint8Array>;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const execFileAsync = promisify(execFile);

const changedSince = (dir: string, since: number) =>
  readdirSync(dir).filter(
    (name) => statSync(path.join(dir, name)).mtimeMs >= since
  );

export class LocalBox implements Box {
  readonly dir = mkdtempSync(path.join(tmpdir(), "hopon-box-"));
  readonly cwd = this.dir;
  private readonly exec = path.join(
    import.meta.dirname,
    "..",
    "image",
    "exec.js"
  );

  static async create() {
    if (!existsSync(RUNTIME_PATH)) {
      await buildRuntime();
    }
    return new LocalBox();
  }

  async run(code: string, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const file = path.join(tmpdir(), `hopon-run-${randomUUID()}.mjs`);
    writeFileSync(file, code);
    const started = Date.now() - 1;
    const result = await execFileAsync(process.execPath, [this.exec, file], {
      cwd: this.dir,
      // No inherited env: the Maker's keys must not reach model code.
      env: {
        HOME: this.dir,
        PATH: process.env.PATH,
        PLAYWRIGHT_BROWSERS_PATH: path.join(
          homedir(),
          "Library",
          "Caches",
          "ms-playwright"
        ),
      },
      maxBuffer: 16 * 1024 * 1024,
      timeout: timeoutMs,
    })
      .then(({ stdout, stderr }) => ({ exitCode: 0, stderr, stdout }))
      .catch(
        (error: ExecFileException & { stdout: string; stderr: string }) => ({
          exitCode: typeof error.code === "number" ? error.code : 124,
          stderr: error.killed
            ? `${error.stderr}\nkilled after ${timeoutMs}ms`
            : error.stderr,
          stdout: error.stdout,
        })
      );
    return { ...result, files: changedSince(this.dir, started) };
  }

  writeFile(file: string, content: string | Uint8Array) {
    writeFileSync(path.join(this.dir, file), content);
    return Promise.resolve();
  }

  async readFile(file: string) {
    return new Uint8Array(await readFile(path.join(this.dir, file)));
  }
}

export const E2B_TEMPLATE = "hopon-maker";
const WORKSPACE = "/workspace";

export class E2BBox implements Box {
  readonly sandbox: Sandbox;
  readonly cwd = WORKSPACE;

  constructor(sandbox: Sandbox) {
    this.sandbox = sandbox;
  }

  static async create() {
    return new E2BBox(
      await Sandbox.create(E2B_TEMPLATE, {
        allowInternetAccess: false,
        // ponytail: 10 min idle kill for the spike; the Maker pauses on turn end instead.
        timeoutMs: 600_000,
      })
    );
  }

  static async resume(sandboxId: string) {
    return new E2BBox(await Sandbox.connect(sandboxId));
  }

  async run(code: string, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const file = `/tmp/run-${Date.now()}.mjs`;
    await this.sandbox.files.write(file, code);
    const marker = `/tmp/mark-${Date.now()}`;
    // A failed command throws CommandExitError, which carries the same fields as a result.
    const result = await this.sandbox.commands
      .run(
        `touch ${marker} && node /opt/hopon/exec.js ${file}; code=$?; find ${WORKSPACE} -maxdepth 1 -type f -newer ${marker} -printf '%f\\n' > /tmp/changed; exit $code`,
        { cwd: WORKSPACE, timeoutMs }
      )
      .catch((error: unknown) => {
        if (error && typeof error === "object" && "exitCode" in error) {
          return error as { stdout: string; stderr: string; exitCode: number };
        }
        throw error;
      });
    const changed = await this.sandbox.files
      .read("/tmp/changed")
      .catch(() => "");
    return {
      exitCode: result.exitCode,
      files: changed.split("\n").filter(Boolean),
      stderr: result.stderr,
      stdout: result.stdout,
    };
  }

  async writeFile(file: string, content: string | Uint8Array) {
    await this.sandbox.files.write(
      `${WORKSPACE}/${file}`,
      typeof content === "string"
        ? content
        : new Blob([new Uint8Array(content)])
    );
  }

  readFile(file: string) {
    return this.sandbox.files.read(`${WORKSPACE}/${file}`, { format: "bytes" });
  }
}
