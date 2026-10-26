/* oxlint-disable complexity, no-promise-executor-return, unicorn/prefer-code-point, no-nested-ternary, typescript/no-invalid-void-type, class-methods-use-this, no-useless-return, no-await-in-loop, no-empty-function, promise/avoid-new, promise/prefer-await-to-then, no-void -- throwaway spike */
// Spike: the Coder on pi-durable instead of pi-coding-agent, set up as Cloudflare's Pi harness docs show
// (developers.cloudflare.com/agents/harnesses/pi/): a plain DurableObject, Lifecycle.install(this).use(PiHarness), a
// registry per object. pi-durable's own CodingTools (read, write, edit, bash) run in the Draft's box through an
// ExecutionEnv over ctx.container.exec; the skills come through agents' skills(); playtest is a replay-safe tool.
// The job id is the submission's operationId, so a POST of the same job after a restart attaches to the running run.
import path from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type } from "@earendil-works/pi-ai";
import type { FetchFunction } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { createModels, createProvider } from "@earendil-works/pi-ai/models";
import { CLOUDFLARE_AI_GATEWAY_MODELS } from "@earendil-works/pi-ai/providers/cloudflare-ai-gateway.models";
import {
  createRegistry,
  defineTool,
  GenerationTask,
  Harness,
  hook,
  ToolTask,
} from "@earendil-works/pi-durable";
import {
  err,
  ExecutionError,
  FileError,
  LineScanner,
  ok,
} from "@earendil-works/pi-durable/env";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { PiHarness, skills } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { fromManifest, parseSkillMarkdown } from "agents/skills";
import { DurableObject } from "cloudflare:workers";

import DOM from "../../../apps/maker/agent-home/.agents/skills/dom-games/SKILL.md";
import LITTLEJS from "../../../apps/maker/agent-home/.agents/skills/littlejs-api/SKILL.md";
import MUSIC_SKILL from "../../../apps/maker/agent-home/.agents/skills/music-synth/SKILL.md";
import ZZFX from "../../../apps/maker/agent-home/.agents/skills/zzfx/SKILL.md";
import AGENTS from "../../../apps/maker/agent-home/AGENTS.md";
import {
  isLittlejsHtml,
  littlejsHtml,
  MUSIC,
} from "../../../apps/maker/image/page.ts";
import type {
  CoderEvent,
  Job,
  PlaytestResult,
} from "../../../apps/maker/src/coder.ts";
import { modelFetch } from "../../../packages/model-fetch/index.ts";
import { execBox } from "./box.ts";

// From apps/maker/src/coder.ts, copied so this Coder doesn't bundle pi-coding-agent.
const deadlineFor = (job: { spec: { music: string | null } }) =>
  120_000 + (job.spec.music ? 30_000 : 0);
const musicScript = (opus: Uint8Array) => {
  let binary = "";
  for (const byte of opus) {
    binary += String.fromCharCode(byte);
  }
  return `hopon.music = "${btoa(binary)}";\n`;
};
const prompt = ({ revision, spec }: Job) =>
  [
    revision === 0
      ? "Build a new game."
      : `Change the game in the workspace (Revision ${revision}).`,
    `Title: ${spec.title}`,
    `Brief: ${spec.brief}`,
    spec.music
      ? `Music: write music.mjs for this game (${spec.music}) and render music.wav.`
      : "Music: none this turn; leave any existing music.mjs as it is.",
  ].join("\n");

const WORKSPACE = "/workspace";
const USER = "1001:1001";
const BOX_ENV = {
  HOME: "/home/user",
  PLAYWRIGHT_BROWSERS_PATH: "/opt/hopon/browsers",
};
const MAX_STEPS = 12;

// coder.ts's prompt, plus AGENTS.md with its one line about reading skills from disk pointed at activate_skill.
const SYSTEM_PROMPT = `You are the Coder in hopon, an app where people make small phone games by chatting. You get one build job from the Talker, who talks to the Creator: a new game to make, or a change to the game in the workspace. You build it, playtest it until it is green, and report back to the Talker. You never talk to the Creator.

Your tools run in the game's workspace, a sandbox with no network. Follow the project instructions below.`;
const PROJECT = AGENTS.replace(
  "Read the skill for the engine with the **read tool**. Skills are not in the workspace, so bash can't see them; don't look for them with bash",
  "Load the skill for the engine with **activate_skill**. Skills are not in the workspace, so bash can't see them; don't look for them with bash"
).replaceAll("Read the `", "Load the `");

const SKILLS = fromManifest({
  fingerprint: "v1",
  id: "hopon-coder",
  skills: [DOM, LITTLEJS, MUSIC_SKILL, ZZFX].map((raw) => {
    const parsed = parseSkillMarkdown(raw);
    if (!parsed) {
      throw new Error("bad SKILL.md");
    }
    return {
      body: parsed.body,
      description: parsed.description,
      name: parsed.name,
    };
  }),
});

// One process in the box, both streams read to the end (an unread stream keeps exec() from reporting the exit).
const execRaw = async (
  container: Container,
  argv: string[],
  opts: {
    cwd?: string;
    stdin?: ReadableStream;
    signal?: AbortSignal;
    onOutput?: (text: string, stream: "stdout" | "stderr") => void;
  } = {}
) => {
  const proc = await container.exec(argv, {
    cwd: opts.cwd ?? WORKSPACE,
    env: BOX_ENV,
    signal: opts.signal,
    stderr: "pipe",
    stdin: opts.stdin,
    stdout: "pipe",
    user: USER,
  });
  const read = async (
    stream: ReadableStream | null,
    name: "stdout" | "stderr"
  ) => {
    const chunks: Uint8Array[] = [];
    if (!stream) {
      return new Uint8Array();
    }
    const decoder = new TextDecoder();
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
      opts.onOutput?.(decoder.decode(chunk, { stream: true }), name);
    }
    return new Uint8Array(await new Blob(chunks).arrayBuffer());
  };
  const [stdout, stderr, exitCode] = await Promise.all([
    read(proc.stdout, "stdout"),
    read(proc.stderr, "stderr"),
    proc.exitCode,
  ]);
  return { exitCode, stderr: new TextDecoder().decode(stderr), stdout };
};

const notFound = (stderr: string) =>
  /No such file|cannot stat|not found/iu.test(stderr);
const fileFail = (stderr: string, p: string) =>
  err(
    new FileError(
      notFound(stderr) ? "not_found" : "unknown",
      stderr.trim() || `failed: ${p}`,
      p
    )
  );
const unsupported = (name: string) => () =>
  Promise.resolve(
    err(new FileError("not_supported", `${name} is not supported in the box`))
  );

// pi-durable's ExecutionEnv over the Draft's box: what the four coding tools call (absolutePath, joinPath,
// canonicalPath, exists, fileInfo, openBinaryReader, readTextFile, writeFile, exec), plus the easy rest.
export const boxEnv = (container: Container, id: string) => {
  const resolve = (p: string) => path.posix.resolve(WORKSPACE, p);
  const cat = async (p: string) => {
    const r = await execRaw(container, ["cat", "--", resolve(p)]);
    return r.exitCode === 0
      ? ok<Uint8Array, FileError>(r.stdout)
      : fileFail(r.stderr, p);
  };
  const fileInfo = async (p: string) => {
    const r = await execRaw(container, [
      "stat",
      "-c",
      "%F|%s|%Y",
      "--",
      resolve(p),
    ]);
    if (r.exitCode !== 0) {
      return fileFail(r.stderr, p);
    }
    const [type = "", size = "0", mtime = "0"] = new TextDecoder()
      .decode(r.stdout)
      .trim()
      .split("|");
    const kind = type.includes("directory")
      ? "directory"
      : type.includes("link")
        ? "symlink"
        : "file";
    return ok({
      kind,
      mtimeMs: Number(mtime) * 1000,
      name: path.posix.basename(p),
      path: resolve(p),
      size: Number(size),
    } as const);
  };
  const write = async (
    p: string,
    content: string | Uint8Array,
    append = false
  ) => {
    const r = await execRaw(
      container,
      [
        "bash",
        "-c",
        `mkdir -p "$(dirname "$1")" && cat ${append ? ">>" : ">"} "$1"`,
        "write",
        resolve(p),
      ],
      {
        stdin: new Response(content).body ?? undefined,
      }
    );
    return r.exitCode === 0 ? ok<void, FileError>() : fileFail(r.stderr, p);
  };
  const simple = async (argv: string[], p: string) => {
    const r = await execRaw(container, argv);
    return r.exitCode === 0 ? ok<void, FileError>() : fileFail(r.stderr, p);
  };
  return {
    absolutePath: (p: string) => Promise.resolve(ok(resolve(p))),
    appendFile: (p: string, content: string | Uint8Array) =>
      write(p, content, true),
    canonicalPath: async (p: string) => {
      const r = await execRaw(container, ["realpath", "-m", "--", resolve(p)]);
      return r.exitCode === 0
        ? ok(new TextDecoder().decode(r.stdout).trim())
        : fileFail(r.stderr, p);
    },
    cleanup: () => Promise.resolve(),
    createDir: (p: string, options?: { recursive?: boolean }) =>
      simple(
        ["mkdir", ...(options?.recursive ? ["-p"] : []), "--", resolve(p)],
        p
      ),
    createTempDir: unsupported("createTempDir"),
    createTempFile: unsupported("createTempFile"),
    cwd: WORKSPACE,
    exec: async (
      command: string | readonly string[],
      options:
        | {
            cwd?: string;
            timeout?: number;
            onOutput?: (
              text: string,
              context: unknown,
              info: { stream: "stdout" | "stderr" }
            ) => void;
          }
        | undefined,
      context: { abortSignal?: AbortSignal }
    ) => {
      const signals = [context.abortSignal].filter(Boolean) as AbortSignal[];
      const timeout = options?.timeout
        ? AbortSignal.timeout(options.timeout * 1000)
        : undefined;
      if (timeout) {
        signals.push(timeout);
      }
      try {
        const r = await execRaw(
          container,
          typeof command === "string" ? ["bash", "-lc", command] : [...command],
          {
            cwd: options?.cwd ? resolve(options.cwd) : WORKSPACE,
            onOutput: (text, stream) =>
              options?.onOutput?.(text, context, { stream }),
            signal: signals.length > 0 ? AbortSignal.any(signals) : undefined,
          }
        );
        if (timeout?.aborted) {
          return err(
            new ExecutionError(
              "timeout",
              `timed out after ${options?.timeout} s`
            )
          );
        }
        if (context.abortSignal?.aborted) {
          return err(new ExecutionError("aborted", "aborted"));
        }
        return ok({ exitCode: r.exitCode });
      } catch (error) {
        return err(
          new ExecutionError(
            context.abortSignal?.aborted ? "aborted" : "spawn_error",
            String(error)
          )
        );
      }
    },
    exists: async (p: string) => {
      const r = await execRaw(container, ["test", "-e", resolve(p)]);
      return ok(r.exitCode === 0);
    },
    fileInfo,
    flushFile: () => Promise.resolve(ok()),
    id,
    joinPath: (parts: string[]) =>
      Promise.resolve(ok(path.posix.join(...parts))),
    listDir: async (p: string) => {
      const r = await execRaw(container, [
        "find",
        resolve(p),
        "-mindepth",
        "1",
        "-maxdepth",
        "1",
        "-printf",
        "%y|%s|%T@|%f\\n",
      ]);
      if (r.exitCode !== 0) {
        return fileFail(r.stderr, p);
      }
      return ok(
        new TextDecoder()
          .decode(r.stdout)
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const [y = "f", size = "0", mtime = "0", name = ""] =
              line.split("|");
            return {
              kind: y === "d" ? "directory" : y === "l" ? "symlink" : "file",
              mtimeMs: Number(mtime) * 1000,
              name,
              path: path.posix.join(resolve(p), name),
              size: Number(size),
            };
          })
      );
    },
    openBinaryReader: async (p: string) => {
      const info = await fileInfo(p);
      if (!info.ok) {
        return info;
      }
      if (info.value.kind === "directory") {
        return err(new FileError("is_directory", `${p} is a directory`, p));
      }
      const bytes = await cat(p);
      if (!bytes.ok) {
        return bytes;
      }
      // ponytail: the whole file is read once and served from memory; the box's files are a game's few KB.
      return ok({
        close: () => Promise.resolve(),
        info: () => Promise.resolve(info),
        read: (offset: number, length: number) =>
          Promise.resolve(ok(bytes.value.subarray(offset, offset + length))),
        scanLines: (options: { startLine: number; endLine?: number }) => {
          const scanner = new LineScanner(options.startLine, options.endLine);
          scanner.push(bytes.value);
          return Promise.resolve(ok(scanner.finish()));
        },
      });
    },
    openDirReader: unsupported("openDirReader"),
    openTextLineReader: unsupported("openTextLineReader"),
    readBinaryFile: cat,
    readTextFile: async (p: string) => {
      const r = await cat(p);
      return r.ok ? ok(new TextDecoder().decode(r.value)) : r;
    },
    readTextLines: async (p: string, options?: { maxLines?: number }) => {
      const r = await cat(p);
      return r.ok
        ? ok(
            new TextDecoder()
              .decode(r.value)
              .split("\n")
              .slice(0, options?.maxLines)
          )
        : r;
    },
    remove: (p: string, options?: { recursive?: boolean; force?: boolean }) =>
      simple(
        [
          "rm",
          ...(options?.recursive ? ["-r"] : []),
          ...(options?.force ? ["-f"] : []),
          "--",
          resolve(p),
        ],
        p
      ),
    renameFile: (from: string, to: string) =>
      simple(["mv", "--", resolve(from), resolve(to)], from),
    truncateFile: (p: string, size: number) =>
      simple(["truncate", "-s", String(size), "--", resolve(p)], p),
    watch: unsupported("watch"),
    writeFile: (p: string, content: string | Uint8Array) => write(p, content),
  };
};

const Input = Type.Object({
  at: Type.Number({ description: "ms after the start tap" }),
  dx: Type.Optional(Type.Number({ description: "swipe distance, CSS px" })),
  dy: Type.Optional(Type.Number({ description: "swipe distance, CSS px" })),
  type: Type.Union([Type.Literal("tap"), Type.Literal("swipe")]),
  x: Type.Number(),
  y: Type.Number(),
});

const stepLabel = (tool: string, args: Record<string, unknown>) => {
  if (tool === "playtest") {
    return "Playtesting";
  }
  if (tool === "activate_skill" || tool === "read_skill_resource") {
    return "Reading the docs";
  }
  if (tool === "read") {
    return "Reading the game";
  }
  if (tool === "bash" && String(args.command).includes("music")) {
    return "Writing music";
  }
  return tool === "edit" ? "Fixing the game" : "Writing the game";
};

const REVISION_FILES = ["index.html", "game.ts", "game.js", "music.mjs"];

interface JobState {
  jobId: string;
  input: Job;
  deadlineAt: number;
  steps: number;
  playtests: PlaytestResult[];
  stopped?: string;
}

export class PiCoder extends DurableObject<
  Env & {
    CLOUDFLARE_API_KEY: string;
    CLOUDFLARE_ACCOUNT_ID: string;
    CLOUDFLARE_GATEWAY_ID: string;
    BOX_SNAPSHOT?: string;
  }
> {
  registry = createRegistry();
  listeners = new Set<(event: unknown) => void>();

  get draftId() {
    return this.ctx.id.name ?? "unnamed";
  }

  get container() {
    if (!this.ctx.container) {
      throw new Error("no container binding");
    }
    return this.ctx.container;
  }

  // The job record lives in the object's own storage, so a restarted object still knows its limits and playtests.
  get job(): JobState | undefined {
    return this.ctx.storage.kv.get<JobState>("job");
  }

  set job(state: JobState) {
    this.ctx.storage.kv.put("job", state);
  }

  // The Session's model spend so far, in dollars: pi keeps it per conversation in pi.usage.
  async spent() {
    const pi = await this.harness.pi();
    const usage = (await pi.usage(BACKGROUND_CONTEXT)) as {
      models: Record<string, { cost?: { total?: number } }>;
    };
    return Object.values(usage.models).reduce(
      (sum, u) => sum + (u.cost?.total ?? 0),
      0
    );
  }

  emit(event: unknown) {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  model() {
    return {
      ...CLOUDFLARE_AI_GATEWAY_MODELS["claude-haiku-5-5"],
      baseUrl: "http://models.internal/anthropic",
      provider: "anthropic",
    };
  }

  harness = new PiHarness({
    defaults: { model: this.model() as never, thinkingLevel: "low" },
    harness: async ({ storage, context, onWake }) => {
      const playtest = defineTool({
        description:
          "Typecheck and play the game in headless Chromium (360×640): loads it, taps the centre to start, runs your inputs, and returns the result with screenshots of the start and the end.",
        execute: async ({ inputs }, _api, toolContext) => {
          const arg = JSON.stringify({ inputs: inputs ?? [] }).replaceAll(
            "'",
            String.raw`'\''`
          );
          const run = await execRaw(
            this.container,
            ["bash", "-lc", `node /opt/hopon/playtest.js '${arg}'`],
            { signal: toolContext.abortSignal }
          );
          const line =
            new TextDecoder().decode(run.stdout).trim().split("\n").at(-1) ??
            "";
          let result: PlaytestResult;
          try {
            result = JSON.parse(line) as PlaytestResult;
          } catch {
            result = {
              errors: [
                `playtest crashed: ${(run.stderr || line).slice(0, 500)}`,
              ],
              ok: false,
              typeErrors: [],
            };
          }
          const { job } = this;
          if (job) {
            this.job = { ...job, playtests: [...job.playtests, result] };
          }
          this.emit({
            errors: [...result.typeErrors, ...result.errors],
            ok: result.ok,
            type: "playtest",
          });
          const images =
            result.typeErrors.length > 0
              ? []
              : await Promise.all(
                  ["playtest-start.png", "playtest-end.png"].map(
                    async (file) => {
                      const png = await execRaw(this.container, [
                        "cat",
                        `${WORKSPACE}/${file}`,
                      ]);
                      let binary = "";
                      for (const byte of png.stdout) {
                        binary += String.fromCharCode(byte);
                      }
                      return {
                        data: btoa(binary),
                        mimeType: "image/png",
                        type: "image" as const,
                      };
                    }
                  )
                );
          return {
            output: [{ text: JSON.stringify(result), type: "text" }, ...images],
          };
        },
        executionMode: "sequential",
        name: "playtest",
        parameters: Type.Object({
          inputs: Type.Optional(
            Type.Array(Input, {
              description:
                "Taps and swipes for your game's controls, in CSS px; 3 s of play when empty",
            })
          ),
        }),
        // Plays the workspace as it is and writes only its own screenshots: running it twice is harmless.
        replay: "safe",
      });
      // #116's step limit: the 13th call is blocked and the run aborted.
      const limits = hook(ToolTask, {
        beforeTool: (call) => {
          const { job } = this;
          if (!job || call.parent) {
            return;
          }
          const steps = job.steps + 1;
          this.job = { ...job, steps };
          if (steps > MAX_STEPS) {
            this.job = {
              ...job,
              steps,
              stopped: job.stopped ?? `over ${MAX_STEPS} steps`,
            };
            setTimeout(() => void this.harness.session().abort(), 0);
            return { block: `Over the ${MAX_STEPS}-step limit.` };
          }
          this.emit({
            label: stepLabel(
              call.name,
              (call.arguments ?? {}) as Record<string, unknown>
            ),
            type: "step",
          });
          return;
        },
      });
      // The job's ending (music render, files read back) runs inside pi's run, when the model gives its final answer,
      // so it happens even when nobody is connected and the object restarted on its own. A stopped run (deadline,
      // step limit, cancel) never yields; the handler ends that one.
      const ending = hook(GenerationTask, {
        onYield: async (answer) => {
          const state = this.job;
          if (!state || this.ctx.storage.kv.get(`final:${state.jobId}`)) {
            return;
          }
          const text = answer.content
            .flatMap((part) => (part.type === "text" ? [part.text] : []))
            .join("");
          const final = await this.finish(state.input, state, text);
          this.ctx.storage.kv.put(`final:${state.jobId}`, final);
          this.emit(final);
          return;
        },
      });
      this.registry.install(CodingTools);
      this.registry.install({
        hooks: [limits, ending],
        name: "coder",
        sections: [
          { key: "preamble", render: () => SYSTEM_PROMPT, tag: false },
          { key: "project", render: () => PROJECT },
        ],
        tools: [playtest],
      });
      this.registry.install(await skills([SKILLS]));
      const api = anthropicMessagesApi();
      const fetch: FetchFunction = (input, init) =>
        modelFetch(new Request(input, init), this.env, {
          metadata: {
            agent: "coder",
            draftId: this.draftId,
            jobId: this.job?.jobId ?? "none",
          },
        });
      const models = createModels();
      models.setProvider(
        createProvider({
          api: {
            stream: (model, ctx, options) =>
              api.stream(model, ctx, { ...options, fetch }),
            streamSimple: (model, ctx, options) =>
              api.streamSimple(model, ctx, { ...options, fetch }),
          },
          auth: {
            apiKey: {
              name: "modelFetch",
              resolve: () =>
                Promise.resolve({
                  auth: { apiKey: "placeholder" },
                  source: "modelFetch",
                }),
            },
          },
          id: "anthropic",
          models: [this.model() as never],
        })
      );
      return Harness.open(
        storage,
        {
          env: () => boxEnv(this.container, `box:${this.draftId}`) as never,
          models,
          onWake,
          registry: this.registry,
          settings: { contextRetentionMs: 0, documentRetentionMs: 0 },
        },
        context
      );
    },
  });

  lifecycle = Lifecycle.install(this).use(this.harness);

  async boot() {
    const startedAt = Date.now();
    if (this.container.running) {
      return { alreadyRunning: true, ms: 0 };
    }
    this.container.start({
      enableInternet: false,
      instance: { diskMb: 6000, memoryMib: 6144, vcpu: 2 },
      ...(this.env.BOX_SNAPSHOT
        ? {
            containerSnapshot: { id: this.env.BOX_SNAPSHOT },
            entrypoint: ["node", "/opt/hopon/browser.js"],
            env: BOX_ENV,
          }
        : { image: (this.container.images as Record<string, string>).box }),
    } as never);
    for (;;) {
      try {
        const proc = await this.container.exec(["true"], {
          stderr: "ignore",
          stdout: "ignore",
        });
        if ((await proc.exitCode) === 0) {
          break;
        }
      } catch {
        // Not up yet.
      }
      if (Date.now() - startedAt > 120_000) {
        throw new Error("box not up after 120 s");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // The box outlives an idle or restarted object for 10 min, so a resumed run and the next turn find it.
    await this.container.setInactivityTimeout(600_000);
    // ponytail: no wait for Chromium; playtest launches its own if :9222 isn't up yet.
    return { execReadyMs: Date.now() - startedAt };
  }

  // The workspace holds exactly the job's source (a LittleJS game's index.html is the harness's, not the Coder's).
  async restore(source: Job["source"]) {
    const box = execBox(this.container);
    await box.commands.run(`find ${WORKSPACE} -mindepth 1 -delete`, {
      cwd: WORKSPACE,
    });
    await Promise.all(
      Object.entries(source)
        .filter(
          ([file, text]) => file !== "index.html" || !isLittlejsHtml(text)
        )
        .map(([file, text]) => box.files.write(`${WORKSPACE}/${file}`, text))
    );
  }

  // coder.ts's ending: music rendered, the Revision's files diffed against the job's source.
  async finish(
    job: Job,
    state: JobState,
    text: string | undefined
  ): Promise<CoderEvent> {
    const box = execBox(this.container);
    const read = async (file: string) => {
      try {
        return (await box.files.read(`${WORKSPACE}/${file}`)) as string;
      } catch {
        return null;
      }
    };
    let reason = state.stopped;
    if (!reason && state.playtests.at(-1)?.ok !== true) {
      reason =
        state.playtests.length === 0
          ? "never playtested"
          : "last playtest not green";
    }
    if (!reason && job.spec.music) {
      const run = (await box.commands
        .run(
          "node music.mjs >/dev/null && ffprobe -v error -show_entries format=duration -of csv=p=0 music.wav && ffmpeg -y -loglevel error -i music.wav -c:a libopus -b:a 64k music.opus",
          { cwd: WORKSPACE, timeoutMs: 120_000 }
        )
        .catch((error: unknown) => error)) as {
        exitCode?: number;
        stdout?: string;
        stderr?: string;
      };
      const seconds = Number(String(run.stdout).trim());
      if (run.exitCode !== 0) {
        reason = `music.mjs failed: ${String(run.stderr).slice(0, 300)}`;
      } else if (!(seconds >= 20 && seconds <= 40)) {
        reason = `music.wav is ${seconds} s, not 20–40 s`;
      }
    }
    if (reason) {
      return { reason, type: "failed" };
    }
    const texts = await Promise.all(REVISION_FILES.map(read));
    const files: Record<string, string> = {};
    const deleted: string[] = [];
    const boxFiles = Object.fromEntries(
      REVISION_FILES.map((file, i) => [file, texts[i] ?? null])
    );
    const rendered = Boolean(job.spec.music);
    const music =
      rendered || (boxFiles["music.mjs"] !== null && "music.mjs" in job.source);
    if (boxFiles["index.html"] === null && boxFiles["game.ts"] !== null) {
      boxFiles["index.html"] = littlejsHtml(music);
    }
    for (const [file, content] of Object.entries(boxFiles)) {
      if (content === null && file in job.source) {
        deleted.push(file);
      } else if (content !== null && content !== job.source[file]) {
        files[file] = content;
      }
    }
    if (rendered) {
      files[MUSIC] = musicScript(
        (await box.files.read(`${WORKSPACE}/music.opus`, {
          format: "bytes",
        })) as Uint8Array
      );
    }
    return { deleted, files, summary: (text ?? "").trim(), type: "done" };
  }

  async fetch(request: Request) {
    const { pathname } = new URL(request.url);
    if (request.method === "DELETE" && pathname === "/box") {
      if (this.container.running) {
        await this.container.destroy();
      }
      return new Response(null, { status: 204 });
    }
    const jobId = /^\/jobs\/(?<jobId>[^/]+)$/u.exec(pathname)?.groups?.jobId;
    if (request.method !== "POST" || !jobId) {
      return new Response("Not found", { status: 404 });
    }
    const job = (await request.json()) as Job;
    job.draftId = this.draftId;
    const { readable, writable } = new TransformStream<Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const send = (line: unknown) =>
      writer.write(encoder.encode(`${JSON.stringify(line)}\n`)).catch(() => {});
    const work = async () => {
      const startedAt = Date.now();
      const ping = setInterval(() => void send({ type: "ping" }), 10_000);
      this.listeners.add(send);
      try {
        const done = this.ctx.storage.kv.get<CoderEvent>(`final:${jobId}`);
        if (done) {
          await send(done);
          return;
        }
        const booted = await this.boot();
        const attached = this.job?.jobId === jobId;
        await send({ attached, booted, type: "spike" });
        if (!attached) {
          await this.restore(job.source);
          const session = this.harness.session();
          if (await session.busy()) {
            await session.abort();
          }
          await session.reset();
          this.job = {
            deadlineAt: startedAt + deadlineFor(job),
            input: job,
            jobId,
            playtests: [],
            steps: 0,
          };
          this.ctx.storage.kv.put(`spentBefore:${jobId}`, await this.spent());
          await this.harness.submit(prompt(job), { operationId: jobId });
        }
        const state = this.job as JobState;
        const deadline = setTimeout(
          () => {
            this.job = {
              ...(this.job as JobState),
              stopped: `past the ${deadlineFor(job) / 1000} s deadline`,
            };
            void this.harness.session().abort();
          },
          Math.max(0, state.deadlineAt - Date.now())
        );
        const result = await this.harness.wait(jobId);
        clearTimeout(deadline);
        // The ending ran inside pi's run unless the run was stopped; onYield's emit already reached a live stream.
        let final = this.ctx.storage.kv.get<CoderEvent>(`final:${jobId}`);
        if (!final) {
          final = await this.finish(job, this.job as JobState, result.text);
          this.ctx.storage.kv.put(`final:${jobId}`, final);
        }
        await send(final);
        console.log(
          "pi-coder result",
          JSON.stringify({
            cost:
              (await this.spent()) -
              (this.ctx.storage.kv.get<number>(`spentBefore:${jobId}`) ?? 0),
            final: final.type,
            jobId,
            playtests: this.job?.playtests.length,
            reason: result.reason,
            status: result.status,
            steps: this.job?.steps,
            wallMs: Date.now() - startedAt,
          })
        );
      } catch (error) {
        await send({
          reason:
            `pi-coder error: ${error instanceof Error ? error.stack : String(error)}`.slice(
              0,
              1500
            ),
          type: "failed",
        });
      } finally {
        clearInterval(ping);
        this.listeners.delete(send);
        await writer.close().catch(() => {});
      }
    };
    this.ctx.waitUntil(work());
    return new Response(readable, {
      headers: { "content-type": "application/x-ndjson" },
    });
  }
}
