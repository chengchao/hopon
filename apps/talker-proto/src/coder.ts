/* oxlint-disable avoid-new, no-await-in-loop, no-promise-executor-return, prefer-destructuring -- PROTOTYPE (#128): throwaway code on prototype/talker-framework */
// PROTOTYPE (#128): a fake Coder. `POST /jobs/:id` starts the job the first time and attaches to it after that; the
// body streams `progress n/60` lines from the job's own clock, so a caller that re-attaches picks up where it is.
// `POST /jobs/:id/cancel` stops it, `GET /jobs/:id` reports how many times it was started and attached.
import { DurableObject } from "cloudflare:workers";

interface Env {
  JOB: DurableObjectNamespace<Job>;
  JOB_SECONDS: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class Job extends DurableObject<Env> {
  async fetch(request: Request) {
    const { storage } = this.ctx;
    const url = new URL(request.url);
    const id = url.pathname.split("/")[2];
    if (url.pathname.endsWith("/cancel")) {
      await storage.put("cancelled", true);
      console.log(`[coder] ${id} cancelled`);
      return Response.json({ cancelled: true });
    }
    if (request.method === "GET") {
      const all = Object.fromEntries(await storage.list());
      return Response.json(all);
    }
    const spec = await request.text();
    let startedAt = await storage.get<number>("startedAt");
    if (startedAt === undefined) {
      startedAt = Date.now();
      await storage.put({
        spec,
        startedAt,
        starts: ((await storage.get<number>("starts")) ?? 0) + 1,
      });
      console.log(`[coder] ${id} START ${spec.slice(0, 60)}`);
    } else {
      await storage.put(
        "attaches",
        ((await storage.get<number>("attaches")) ?? 0) + 1
      );
      console.log(
        `[coder] ${id} ATTACH at ${Math.round((Date.now() - startedAt) / 1000)} s`
      );
    }
    const total = Number(this.env.JOB_SECONDS);
    const begun = startedAt;
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        for (;;) {
          if (await storage.get("cancelled")) {
            controller.enqueue(encoder.encode("cancelled\n"));
            break;
          }
          const elapsed = Math.floor((Date.now() - begun) / 1000);
          if (elapsed >= total) {
            controller.enqueue(
              encoder.encode(
                `done: built "${spec.slice(0, 80)}" as game.js (rev ${id.slice(-4)})\n`
              )
            );
            break;
          }
          controller.enqueue(encoder.encode(`progress ${elapsed}/${total}\n`));
          await sleep(1000);
        }
        controller.close();
      },
    });
    return new Response(body, { headers: { "content-type": "text/plain" } });
  }
}

export default {
  fetch(request: Request, env: Env) {
    const id = new URL(request.url).pathname.split("/")[2];
    return id
      ? env.JOB.getByName(id).fetch(request)
      : new Response("POST /jobs/:id", { status: 404 });
  },
};
