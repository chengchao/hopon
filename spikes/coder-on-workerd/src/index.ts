/* oxlint-disable complexity, unicorn/prefer-export-from, import/first, no-await-in-loop, no-empty-function, no-promise-executor-return, no-void, promise/avoid-new, promise/prefer-await-to-callbacks, promise/prefer-await-to-then, promise/prefer-catch -- throwaway spike */
// Spike: the Coder as one Durable Object per Draft that runs pi's loop itself (apps/maker/src/coder.ts runJob,
// unchanged), with the Draft's box a Container it controls through the Durable Object Container API. No E2B, no Coder
// Container. Routes mirror the dev route coder-smoke.mjs uses:
//   POST   /__coder/:draftId/jobs/:jobId   the job in, NDJSON out
//   DELETE /__coder/:draftId/box           destroys the box
//   POST   /__coder/:draftId/snapshot      snapshots the box's filesystem
//   POST   /__coder/:draftId/boot          boots the box (from ?snapshot=<id> if given) and times it
import { mkdirSync, writeFileSync } from "node:fs";

import { DurableObject } from "cloudflare:workers";
// Two copies of TypeBox 1.3.27 are bundled: the spike's (pi-durable, pi-ai 1.4) and pnpm's (pi-coding-agent, pi-ai 1.3).
import { Settings } from "typebox/system";

import DOM from "../../../apps/maker/agent-home/.agents/skills/dom-games/SKILL.md";
import LITTLEJS from "../../../apps/maker/agent-home/.agents/skills/littlejs-api/SKILL.md";
import MUSIC from "../../../apps/maker/agent-home/.agents/skills/music-synth/SKILL.md";
import ZZFX from "../../../apps/maker/agent-home/.agents/skills/zzfx/SKILL.md";
import { Settings as PnpmSettings } from "../../../node_modules/.pnpm/typebox@1.3.27/node_modules/typebox/build/system/index.mjs";
import BROWSER from "../box/files/browser.js.txt";
import DOM_D from "../box/files/dom.d.ts.txt";
import DOM_JS from "../box/files/dom.js.txt";
import HELPERS from "../box/files/helpers.js.txt";
import LITTLEJS_D from "../box/files/littlejs.d.ts.txt";
import PAGE from "../box/files/page.ts.txt";
import PLAYTEST from "../box/files/playtest.js.txt";
import RUNTIME from "../box/files/runtime.js.txt";
// apps/maker/eval/revisions/stacker/game.ts, as text.
import STACKER from "./stacker.txt";

// apps/maker/image's files, copied by hand into box/files (gitignored) for /setup.
const BOX_FILES = {
  "browser.js": BROWSER,
  "dom.d.ts": DOM_D,
  "dom.js": DOM_JS,
  "helpers.js": HELPERS,
  "littlejs.d.ts": LITTLEJS_D,
  "page.ts": PAGE,
  "playtest.js": PLAYTEST,
  "runtime.js": RUNTIME,
};
import AGENTS from "../../../apps/maker/agent-home/AGENTS.md";
import { runJob } from "../../../apps/maker/src/coder.ts";
import type { CoderEvent, Job } from "../../../apps/maker/src/coder.ts";
import { CANDIDATES, routeModels } from "../../../apps/maker/src/models.ts";
import { modelFetch } from "../../../packages/model-fetch/index.ts";
import { execBox, memoryBox } from "./box.ts";
import "./reload.ts";
import { PiCoder } from "./pi-coder.ts";
import { probe, readPng } from "./probe.ts";

export { PiCoder };

// coder.ts reads agent-home from path.join(import.meta.dirname, "..", "agent-home"); wrangler's `define` makes that
// /tmp/maker/agent-home, and each job writes the bundled copy there (workerd's /tmp lives for one request).
const AGENT_HOME = {
  ".agents/skills/dom-games/SKILL.md": DOM,
  ".agents/skills/littlejs-api/SKILL.md": LITTLEJS,
  ".agents/skills/music-synth/SKILL.md": MUSIC,
  ".agents/skills/zzfx/SKILL.md": ZZFX,
  "AGENTS.md": AGENTS,
};
const writeAgentHome = () => {
  for (const [file, text] of Object.entries(AGENT_HOME)) {
    const full = `/tmp/maker/agent-home/${file}`;
    mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true });
    writeFileSync(full, text);
  }
};

// workerd forbids new Function inside a request; TypeBox caches CanEvaluate() true from startup, so pi-ai's Compile()
// of every tool schema throws "Code generation from strings disallowed". Its interpreted checker needs no eval.
PnpmSettings.Set({ useAcceleration: false });
if (!globalThis.PI_DURABLE_EVAL_TEST) {
  Settings.Set({ useAcceleration: false });
}

// Deployed, every route sits under /t/<SPIKE_TOKEN>/ so nobody else spends the model key.
const ROUTE =
  /^\/t\/(?<token>[^/]+)(?<pi>\/pi)?\/__coder\/(?<draftId>[^/]+)(?<path>\/.*)$/u;

interface SpikeEnv {
  CODER: DurableObjectNamespace<Coder>;
  PI_CODER: DurableObjectNamespace<PiCoder>;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_GATEWAY_ID: string;
  CLOUDFLARE_API_KEY: string;
  SPIKE_TOKEN: string;
  BOX_SNAPSHOT?: string;
  BOX_VCPU?: string;
  BOX_MEMORY_MIB?: string;
  BOX_INSTANCE?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Coder extends DurableObject<SpikeEnv> {
  log: string[] = [];

  get container() {
    const { container } = this.ctx;
    if (!container) {
      throw new Error("no container binding");
    }
    return container;
  }

  instance() {
    if (this.env.BOX_INSTANCE) {
      return this.env.BOX_INSTANCE as "standard-1";
    }
    return {
      diskMb: 6000,
      memoryMib: Number(this.env.BOX_MEMORY_MIB ?? 6144),
      vcpu: Number(this.env.BOX_VCPU ?? 2),
    };
  }

  // Starts the box if it isn't running and waits for its warm Chromium on :9222, as E2B's waitForPort(9222) did at
  // template build. Returns how long that took (0 when already up).
  async boot(snapshot = this.env.BOX_SNAPSHOT || undefined) {
    const startedAt = Date.now();
    if (this.container.running) {
      return { alreadyRunning: true, ms: 0 };
    }
    const instance = this.instance();
    this.container.start({
      enableInternet: false,
      instance,
      // Deployed, the box is a snapshot that /setup made from Cloudflare's debian-trixie image (local Docker's pushes
      // kept failing); a snapshot holds no processes, so the entrypoint starts Chromium again.
      ...(snapshot
        ? {
            containerSnapshot: { id: snapshot },
            entrypoint: ["node", "/opt/hopon/browser.js"],
            env: { PLAYWRIGHT_BROWSERS_PATH: "/opt/hopon/browsers" },
          }
        : { image: this.container.images.box }),
    });
    let startedMs: number | undefined;
    let execMs: number | undefined;
    for (;;) {
      if (startedMs === undefined && this.container.running) {
        startedMs = Date.now() - startedAt;
      }
      if (execMs === undefined) {
        try {
          const proc = await this.container.exec(["true"], {
            stderr: "ignore",
            stdout: "ignore",
          });
          if ((await proc.exitCode) === 0) {
            execMs = Date.now() - startedAt;
          }
        } catch {
          // Not up yet.
        }
      }
      try {
        // oxlint-disable-next-line no-await-in-loop -- polling
        await this.container.getTcpPort(9222).fetch("http://box/json/version");
        break;
      } catch {
        // Not up yet.
      }
      if (Date.now() - startedAt > 120_000) {
        throw new Error("box not up after 120 s");
      }
      // oxlint-disable-next-line no-await-in-loop -- polling
      await sleep(100);
    }
    return {
      execReadyMs: execMs,
      instance,
      ms: Date.now() - startedAt,
      runningAfterMs: startedMs,
      snapshot,
    };
  }

  async fetch(request: Request) {
    const { pathname, searchParams } = new URL(request.url);
    const draftId = this.ctx.id.name ?? "unnamed";
    if (request.method === "DELETE" && pathname === "/box") {
      if (this.container.running) {
        await this.container.destroy();
      }
      return new Response(null, { status: 204 });
    }
    if (request.method === "POST" && pathname === "/boot") {
      return Response.json(
        await this.boot(searchParams.get("snapshot") ?? undefined)
      );
    }
    if (pathname === "/probe") {
      writeAgentHome();
      await this.boot();
      routeModels((modelRequest) =>
        modelFetch(modelRequest, this.env, {
          metadata: { agent: "coder", draftId, jobId: "probe" },
        })
      );
      return Response.json(
        await probe(
          execBox(this.container, (line) => this.log.push(line))
        ).then((ends) => ({ ends, log: this.log.splice(0) }))
      );
    }
    if (pathname === "/readpng") {
      await this.boot();
      return new Response(await readPng(execBox(this.container)));
    }
    if (pathname === "/realpath") {
      const { realpath } = await import("node:fs/promises");
      const out: Record<string, unknown> = {};
      for (const p of ["/workspace/game.ts", "/tmp/nope", "/tmp"]) {
        try {
          out[p] = await realpath(p);
        } catch (error) {
          out[p] = {
            code: (error as { code?: string }).code,
            message: String(error),
          };
        }
      }
      return Response.json(out);
    }
    if (request.method === "POST" && pathname === "/setup") {
      // image/build.ts's steps, run once in a box from Cloudflare's debian-trixie image (Node 24) with internet, then
      // snapshotted: every Draft's box boots from the snapshot with no internet.
      if (this.container.running) {
        await this.container.destroy();
      }
      const startedAt = Date.now();
      this.container.start({
        enableInternet: true,
        entrypoint: ["sleep", "infinity"],
        image: "cloudflare/debian-trixie",
        instance: this.instance(),
      });
      const root = execBox(
        this.container,
        (line) => this.log.push(line),
        "0:0"
      );
      const steps: Record<string, unknown> = {};
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
        await sleep(200);
      }
      steps.execReadyMs = Date.now() - startedAt;
      const step = async (name: string, command: string) => {
        const at = Date.now();
        const result = await root.commands
          .run(command, { cwd: "/", timeoutMs: 600_000 })
          .catch((error: unknown) => error);
        steps[name] = {
          err: String((result as { stderr?: string }).stderr ?? "").slice(-300),
          ms: Date.now() - at,
          tail: String((result as { stdout?: string }).stdout ?? result).slice(
            -300
          ),
        };
      };
      await step(
        "versions",
        "node --version; npm --version; cat /etc/os-release | head -2"
      );
      await step(
        "apt",
        "apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends ffmpeg ca-certificates >/dev/null && ffmpeg -version | head -1"
      );
      await step(
        "npm",
        "mkdir -p /opt/hopon /workspace && cd /opt/hopon && npm init -y >/dev/null && npm pkg set type=module && npm install --silent esbuild@0.28.2 playwright-core@1.58.2 typescript@6.0.3 && ls node_modules | head"
      );
      await step(
        "chromium",
        "cd /opt/hopon && npx playwright-core install --with-deps chromium-headless-shell 2>&1 | tail -3"
      );
      for (const [file, text] of Object.entries(BOX_FILES)) {
        await root.files.write(`/opt/hopon/${file}`, text);
      }
      await step(
        "user",
        "useradd -m -u 1001 user && chown -R user:user /workspace && ls -la /opt/hopon | head -20"
      );
      const at = Date.now();
      const snapshot = await this.container.snapshotContainer({ name: "box" });
      steps.snapshot = { ...snapshot, ms: Date.now() - at };
      await this.container.destroy();
      return Response.json(steps);
    }
    if (request.method === "POST" && pathname === "/timing") {
      // Cold boot, three playtests of one fixed game, a snapshot, then a boot from it and one more playtest. Streams
      // each stage as NDJSON; a stage over 150 s is reported and the rest skipped.
      const { readable, writable } = new TransformStream<Uint8Array>();
      const writer = writable.getWriter();
      const send = (line: unknown) =>
        writer.write(new TextEncoder().encode(`${JSON.stringify(line)}\n`));
      const box = execBox(this.container);
      const playtest = async () => {
        const at = Date.now();
        const result = (await box.commands
          .run("node /opt/hopon/playtest.js '{}'", {
            cwd: "/workspace",
            timeoutMs: 120_000,
          })
          .catch((error: { stdout?: string }) => error)) as { stdout?: string };
        return {
          ms: Date.now() - at,
          ok: String(result.stdout).includes('"ok":true'),
        };
      };
      const stage = async (name: string, run: () => Promise<unknown>) => {
        const at = Date.now();
        const value = await Promise.race([
          run(),
          sleep(150_000).then(() => {
            throw new Error("stage over 150 s");
          }),
        ]);
        await send({ ms: Date.now() - at, stage: name, value });
        return value;
      };
      const work = async () => {
        try {
          if (this.container.running) {
            await stage("destroy", () => this.container.destroy());
          }
          await stage("cold", () => this.boot());
          await stage("write", () =>
            box.files.write("/workspace/game.ts", STACKER)
          );
          for (const n of [1, 2, 3]) {
            await stage(`playtest${n}`, playtest);
          }
          const snapshot = (await stage("snapshot", () =>
            this.container.snapshotContainer({ name: "timing" })
          )) as { id: string };
          await stage("destroy", () => this.container.destroy());
          await stage("restored", () => this.boot(snapshot.id));
          await stage("restoredHasGame", () =>
            box.files.exists("/workspace/game.ts")
          );
          await stage("restoredPlaytest", playtest);
        } catch (error) {
          await send({ error: String(error) });
        } finally {
          await this.container.destroy().catch(() => {});
          await writer.close();
        }
      };
      this.ctx.waitUntil(work());
      return new Response(readable, {
        headers: { "content-type": "application/x-ndjson" },
      });
    }
    if (request.method === "POST" && pathname === "/selftest") {
      await this.boot();
      const box = execBox(this.container, (line) => this.log.push(line));
      const steps: unknown[] = [];
      const time = async (name: string, fn: () => Promise<unknown>) => {
        const at = Date.now();
        try {
          const out = await fn();
          steps.push({ ms: Date.now() - at, name, out });
        } catch (error) {
          steps.push({ error: String(error), ms: Date.now() - at, name });
        }
      };
      await time("write", () => box.files.write("/workspace/a/b.txt", "hello"));
      await time("read", () => box.files.read("/workspace/a/b.txt"));
      await time("exists", () => box.files.exists("/workspace/a/b.txt"));
      await time("run", () =>
        box.commands.run("ls -la /workspace /workspace/a; echo err >&2", {
          cwd: "/workspace",
        })
      );
      await time("fail", () =>
        box.commands.run("exit 3", { cwd: "/workspace" })
      );
      await time("timeout", () =>
        box.commands.run("sleep 5", { cwd: "/workspace", timeoutMs: 1000 })
      );
      await time("playtest", () =>
        box.commands.run("node /opt/hopon/playtest.js '{}'", {
          cwd: "/workspace",
        })
      );
      return Response.json({ log: this.log.splice(0), steps });
    }
    if (request.method === "POST" && pathname === "/snapshot") {
      const startedAt = Date.now();
      const snapshot = await this.container.snapshotContainer({
        name: draftId,
      });
      return Response.json({ ...snapshot, ms: Date.now() - startedAt });
    }
    const jobId = /^\/jobs\/(?<jobId>[^/]+)$/u.exec(pathname)?.groups?.jobId;
    if (request.method !== "POST" || !jobId) {
      return new Response("Not found", { status: 404 });
    }
    const job = (await request.json()) as Job;
    job.draftId = draftId;

    const { readable, writable } = new TransformStream<Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const send = (line: unknown) =>
      writer.write(encoder.encode(`${JSON.stringify(line)}\n`));
    const work = async () => {
      const startedAt = Date.now();
      const trace = (line: string) =>
        void send({ at: Date.now() - startedAt, exec: line, type: "spike" });
      const ping = setInterval(() => void send({ type: "ping" }), 10_000);
      try {
        writeAgentHome();
        // ?fake: no box, an in-memory one whose commands all exit 0 with no output, to test pi's loop alone.
        const fake = searchParams.has("fake");
        const booted = fake ? "fake" : await this.boot();
        await send({ booted, type: "spike" });
        routeModels((modelRequest) =>
          modelFetch(modelRequest, this.env, {
            metadata: { agent: "coder", draftId, jobId },
          })
        );
        const result = await runJob({
          job,
          model: CANDIDATES["claude-haiku-5-5"](),
          onEvent: (event: CoderEvent) => void send(event),
          sandbox: fake ? memoryBox(trace) : execBox(this.container, trace),
          startedAt,
          thinking: "low",
        });
        console.log(
          "spike result",
          JSON.stringify({
            result: {
              errors: result.errors,
              ok: result.ok,
              playtests: result.playtests.length,
              reason: result.reason,
              seconds: result.seconds,
              steps: result.steps,
              toolCalls: result.toolCalls,
              turns: result.turns,
              usage: result.usage,
            },
            type: "spike",
            wallMs: Date.now() - startedAt,
          })
        );
      } catch (error) {
        await send({
          reason: `spike error: ${error instanceof Error ? error.stack : String(error)}`,
          type: "failed",
        });
      } finally {
        clearInterval(ping);
        await writer.close();
      }
    };
    this.ctx.waitUntil(work());
    return new Response(readable, {
      headers: { "content-type": "application/x-ndjson" },
    });
  }
}

export default {
  fetch: (request, env) => {
    const route = ROUTE.exec(new URL(request.url).pathname)?.groups;
    if (!route?.draftId || !route.path || route.token !== env.SPIKE_TOKEN) {
      return new Response("Not found", { status: 404 });
    }
    // /t/<token>/pi/__coder/... goes to the pi-durable Coder (src/pi-coder.ts).
    return (route.pi ? env.PI_CODER : env.CODER)
      .getByName(route.draftId)
      .fetch(
        new Request(
          `http://coder${route.path}${new URL(request.url).search}`,
          request
        )
      );
  },
} satisfies ExportedHandler<SpikeEnv>;
