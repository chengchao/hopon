// The Worker's entry point: the API, plus the classes Cloudflare binds by export name. index.ts stays importable in
// Node, where the tests run it; these need `cloudflare:workers`.
import app from "./index.ts";

export { ContainerProxy } from "@cloudflare/containers";
export { Coder } from "./coder.ts";

// `pnpm -F api dev:coder` sets CODER_DEV, so `smoke:coder` can post a job straight to a Draft's Coder:
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
