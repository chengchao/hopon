// The pi-durable Coder alone, to measure its bundle and startup without pi-coding-agent or the workarounds it needs.
export { PiCoder } from "./pi-coder.ts";

const ROUTE =
  /^\/t\/(?<token>[^/]+)\/pi\/__coder\/(?<draftId>[^/]+)(?<path>\/.*)$/u;

export default {
  fetch: (
    request: Request,
    env: { PI_CODER: DurableObjectNamespace; SPIKE_TOKEN: string }
  ) => {
    const route = ROUTE.exec(new URL(request.url).pathname)?.groups;
    if (!route?.draftId || !route.path || route.token !== env.SPIKE_TOKEN) {
      return new Response("Not found", { status: 404 });
    }
    return env.PI_CODER.getByName(route.draftId).fetch(
      new Request(`http://coder${route.path}`, request)
    );
  },
};
