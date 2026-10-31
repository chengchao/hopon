// The Worker's entry point: the API and its daily cron, plus the classes Cloudflare binds by export name (the Talker and
// the Coder).
// api.ts stays importable in Node, where the tests run it; these need `cloudflare:workers` and pi's packages.
import { drizzle } from "drizzle-orm/d1";

import app from "./api.ts";
import { pruneLimits } from "./storage.ts";

export { DraftCoder } from "./coder.ts";
export { Talker } from "./talker.ts";

// `pnpm -F worker dev:coder` sets CODER_DEV, so `smoke:coder` can post a job straight to a Draft's Coder:
// /__coder/<draftId>/<path> goes to that Coder's <path>. Deployed, CODER_DEV is never set and the path is the API's.
const CODER_DEV_PATH = /^\/__coder\/(?<draftId>[^/]+)(?<path>\/.*)$/u;

export default {
  fetch: (request, env, ctx) => {
    const route =
      env.CODER_DEV === "1"
        ? CODER_DEV_PATH.exec(new URL(request.url).pathname)?.groups
        : undefined;
    return route?.draftId && route.path
      ? env.CODER.getByName(route.draftId).fetch(
          new Request(`http://coder${route.path}`, request)
        )
      : app.fetch(request, env, ctx);
  },
  // The daily cron (wrangler.jsonc's triggers).
  scheduled: async (controller, env) => {
    await pruneLimits(drizzle(env.DB), controller.scheduledTime);
  },
} satisfies ExportedHandler<Env & { CODER_DEV?: string }>;
