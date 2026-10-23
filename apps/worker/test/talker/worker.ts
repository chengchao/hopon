// The Worker for test/talker.test.js: the real API and Talker, with the Coder and the model faked.
// - The model: every model call ends at globalThis.fetch, which answers Cloudflare's /ai/v1/messages here, as a
//   scripted Anthropic stream. A message "build <scenario>" calls `build` with the scenario as the brief; anything
//   else gets a text reply that repeats what the model was last sent, a tool's result included.
// - The Coder: a Durable Object that streams the scenario's NDJSON and records every request, read back through
//   /__fake/coder/<draftId>/calls. A held job ("wait") ends `done` on /__fake/coder/<draftId>/release.
import { DurableObject } from "cloudflare:workers";

import app from "../../src/api.ts";

export { Talker } from "../../src/talker.ts";

interface Block {
  type: string;
  text?: string;
  content?: string | Block[];
}
interface Message {
  role: string;
  content: string | Block[];
}

const texts = (content: string | Block[] | undefined): string[] => {
  if (typeof content === "string") {
    return [content];
  }
  return (content ?? []).flatMap((block) =>
    block.type === "tool_result" ? texts(block.content) : [block.text ?? ""]
  );
};

const sse = (events: object[]) =>
  new Response(
    events
      .map(
        (event) =>
          `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`
      )
      .join(""),
    { headers: { "content-type": "text/event-stream" } }
  );

const reply = (block: object, delta: object, stop: string) =>
  sse([
    {
      message: {
        content: [],
        id: `msg_${crypto.randomUUID()}`,
        model: "claude-haiku-5-5",
        role: "assistant",
        stop_reason: null,
        type: "message",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      type: "message_start",
    },
    { content_block: block, index: 0, type: "content_block_start" },
    { delta, index: 0, type: "content_block_delta" },
    { index: 0, type: "content_block_stop" },
    {
      delta: { stop_reason: stop, stop_sequence: null },
      type: "message_delta",
      usage: { output_tokens: 1 },
    },
    { type: "message_stop" },
  ]);

const model = async (request: Request) => {
  const { messages } = await request.json<{ messages: Message[] }>();
  const said = texts(messages.at(-1)?.content);
  const scenario = said.find((text) => text.startsWith("build "))?.slice(6);
  if (scenario === undefined) {
    return reply(
      { text: "", type: "text" },
      { text: `said: ${said.join(" | ")}`, type: "text_delta" },
      "end_turn"
    );
  }
  return reply(
    {
      id: `toolu_${crypto.randomUUID().replaceAll("-", "")}`,
      input: {},
      name: "build",
      type: "tool_use",
    },
    {
      partial_json: JSON.stringify({
        brief: scenario,
        music: null,
        title: "Moon Cat",
      }),
      type: "input_json_delta",
    },
    "tool_use"
  );
};

const upstream = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const request = new Request(input, init);
  return new URL(request.url).pathname.endsWith("/ai/v1/messages")
    ? model(request)
    : upstream(request);
};

interface Job {
  draftId: string;
  revision: number;
  source: Record<string, string>;
  spec: { brief: string; title: string };
}
interface Call {
  jobId: string;
  cancel?: true;
  revision?: number;
  source?: string[];
}

const encoder = new TextEncoder();
const line = (event: object) => encoder.encode(`${JSON.stringify(event)}\n`);
// The first Revision has music; later ones change game.ts and drop music.mjs.
const done = (job: Job) =>
  job.revision === 0
    ? {
        deleted: [],
        files: {
          "game.js": "engineInit();",
          "game.ts": "// revision 1",
          "index.html": "<!doctype html>moon cat",
          "music.mjs": "// music",
          "music.opus": btoa("OggS"),
        },
        summary: "A cat on the moon. Tap to jump.",
        type: "done",
      }
    : {
        deleted: ["music.mjs"],
        files: {
          "game.js": `engineInit(${job.revision + 1});`,
          "game.ts": `// revision ${job.revision + 1}`,
        },
        summary: `Revision ${job.revision + 1}.`,
        type: "done",
      };

export class Coder extends DurableObject {
  // Held streams, ended by release (done) or cancel (failed cancelled).
  held = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
  // The held "wait" job's `done`.
  releasing: object | undefined;

  async record(call: Call) {
    const calls = (await this.ctx.storage.get<Call[]>("calls")) ?? [];
    await this.ctx.storage.put("calls", [...calls, call]);
    return calls;
  }

  end(event: object) {
    for (const controller of this.held.values()) {
      controller.enqueue(line(event));
      controller.close();
    }
    this.held.clear();
  }

  override async fetch(request: Request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/calls") {
      return Response.json((await this.ctx.storage.get("calls")) ?? []);
    }
    if (pathname === "/release") {
      this.end(this.releasing ?? {});
      return new Response(null, { status: 204 });
    }
    // /jobs/<jobId> or /jobs/<jobId>/cancel
    const [jobId = "", action] = pathname.split("/").slice(2);
    if (action === "cancel") {
      await this.record({ cancel: true, jobId });
      this.end({ reason: "cancelled", type: "failed" });
      return new Response(null, { status: 204 });
    }
    const job = await request.json<Job>();
    const calls = await this.record({
      jobId,
      revision: job.revision,
      source: Object.keys(job.source).toSorted(),
    });
    // A re-POST of a job this Coder has seen is an attach; the job finished meanwhile.
    const attach = calls.some((call) => call.jobId === jobId);
    const scenario = attach ? "done" : job.spec.brief;
    return new Response(
      new ReadableStream<Uint8Array>({
        start: (controller) => {
          controller.enqueue(line({ type: "ping" }));
          controller.enqueue(line({ label: "Writing the game", type: "step" }));
          if (scenario === "done") {
            controller.enqueue(line(done(job)));
            controller.close();
          } else if (scenario === "failed" || scenario === "busy") {
            const reason = scenario === "busy" ? "busy" : "playtest stayed red";
            controller.enqueue(line({ reason, type: "failed" }));
            controller.close();
          } else {
            // "wait" ends on release, "hang" only on cancel.
            this.releasing = scenario === "wait" ? done(job) : undefined;
            this.held.set(jobId, controller);
          }
        },
      }),
      { headers: { "content-type": "application/x-ndjson" } }
    );
  }
}

const FAKE_CODER = /^\/__fake\/coder\/(?<draftId>[^/]+)(?<path>\/.*)$/u;

export default {
  fetch: (request, env, ctx) => {
    const route = FAKE_CODER.exec(new URL(request.url).pathname)?.groups;
    return route?.draftId && route.path
      ? env.CODER.getByName(route.draftId).fetch(`http://coder${route.path}`)
      : app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
