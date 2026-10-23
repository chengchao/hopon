// The Container's entry point: the Coder's server on :8080. Its env, from the Coder class in the Worker, is the E2B key
// (read by the E2B SDK), the model and its effort, and the Draft's id; no model or gateway key.
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebStream } from "node:stream/web";

import { Layer } from "effect";

import { BoxLive, makeCoder, modelsLive } from "./server.ts";

const PORT = 8080;
const env = (name: string) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
};

const handle = makeCoder(
  Layer.mergeAll(
    BoxLive,
    modelsLive(env("MAKER_CODER_MODEL"), env("MAKER_CODER_EFFORT"))
  ),
  { draftId: env("DRAFT_ID") }
);

createServer(async (incoming, outgoing) => {
  const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
  let response: Response;
  try {
    response = await handle(
      new Request(`http://coder${incoming.url}`, {
        body: hasBody ? Buffer.concat(await incoming.toArray()) : undefined,
        headers: incoming.headers as Record<string, string>,
        method: incoming.method,
      })
    );
  } catch (error) {
    response = new Response(String(error), { status: 500 });
  }
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  if (!response.body) {
    outgoing.end();
    return;
  }
  try {
    await pipeline(Readable.fromWeb(response.body as WebStream), outgoing);
  } catch {
    // The caller went away. That cancels its stream, not the job: the next POST attaches.
  }
}).listen(PORT);
