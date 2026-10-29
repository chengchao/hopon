// The Worker's entry point: the API, plus the classes Cloudflare binds by export name (the Talker and the Coder).
// api.ts stays importable in Node, where the tests run it; these need `cloudflare:workers` and pi's packages.
import { DurableObject } from "cloudflare:workers";

import app from "./api.ts";

export { DraftCoder } from "./coder.ts";
export { Talker } from "./talker.ts";

// The old Container Coder's class, empty, until a later deploy deletes it. Cloudflare refuses to delete a class in the
// deploy that moves its binding (CODER) to another class (code 10061), so DraftCoder ships first.
export class Coder extends DurableObject {}

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
} satisfies ExportedHandler<Env & { CODER_DEV?: string }>;
