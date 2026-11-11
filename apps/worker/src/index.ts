// The Worker's entry point: the API and its daily cron, plus the classes Cloudflare binds by export name.
// api.ts stays importable in Node, where the tests run it; these need `cloudflare:workers` and pi's packages.
import { DurableObject } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";

import app from "./api.ts";
import { pruneLimits } from "./storage.ts";

export { Maker } from "./maker.ts";

// The Talker's and the Coder's classes, empty until a later deploy deletes them (ADR 0005): Cloudflare refuses to delete
// a class in the deploy that moves its binding (code 10061, docs/agents/previews.md).
export class Talker extends DurableObject {}
export class DraftCoder extends DurableObject {}

// `pnpm -F worker dev:maker` sets MAKER_DEV, so `smoke:maker` can reach a Draft's Maker without the app:
// /__maker/<draftId>/<path> goes to that Maker's <path>. Deployed, MAKER_DEV is never set and the path is the API's.
const MAKER_DEV_PATH = /^\/__maker\/(?<draftId>[^/]+)(?<path>\/.*)$/u;

export default {
  fetch: (request, env, ctx) => {
    const route =
      env.MAKER_DEV === "1"
        ? MAKER_DEV_PATH.exec(new URL(request.url).pathname)?.groups
        : undefined;
    return route?.draftId && route.path
      ? env.MAKER.getByName(route.draftId).fetch(
          new Request(`http://maker${route.path}`, request)
        )
      : app.fetch(request, env, ctx);
  },
  // The daily cron (wrangler.jsonc's triggers).
  scheduled: async (controller, env) => {
    await pruneLimits(drizzle(env.DB), controller.scheduledTime);
  },
} satisfies ExportedHandler<Env & { MAKER_DEV?: string }>;
