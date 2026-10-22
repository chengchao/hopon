// The Coder (#139): one Container instance per Draft, `env.CODER.getByName(draftId)`, running apps/maker's job server
// (apps/maker/src/server.ts). The Talker POSTs a job to /jobs/:jobId and reads NDJSON events back.
//
// The container holds the E2B key and nothing else. Its model requests go to `http://models.internal`, which only
// the `models` handler below answers, here in the Worker: it adds the key through modelFetch and tags the call with
// the Draft (this instance's name) and the job.
import { Container } from "@cloudflare/containers";
import type { OutboundHandlerContext } from "@cloudflare/containers";
import { modelFetch } from "@hopon/model-fetch";

const MODELS_HOST = "models.internal";
const JOB_PATH = /^\/jobs\/(?<jobId>[^/]+)$/u;

interface ModelCallParams {
  draftId: string;
  jobId: string;
}

export class Coder extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "2m";

  // Assigned, not declared: the base class registers handlers in its static setter, which a class field skips.
  static {
    this.outboundHandlers = {
      models: (
        request: Request,
        env: Env,
        { params }: OutboundHandlerContext<ModelCallParams>
      ) =>
        modelFetch(request, env, {
          metadata: { agent: "coder", ...params },
        }),
    };
  }

  constructor(ctx: DurableObjectState<Record<string, never>>, env: Env) {
    super(ctx, env);
    this.envVars = {
      DRAFT_ID: this.draftId,
      E2B_API_KEY: env.E2B_API_KEY,
      MAKER_CODER_EFFORT: env.MAKER_CODER_EFFORT,
      MAKER_CODER_MODEL: env.MAKER_CODER_MODEL,
    };
  }

  get draftId() {
    const { name } = this.ctx.id;
    if (!name) {
      throw new Error(
        "A Coder is reached by name: env.CODER.getByName(draftId)"
      );
    }
    return name;
  }

  override async fetch(request: Request) {
    const jobId =
      request.method === "POST"
        ? JOB_PATH.exec(new URL(request.url).pathname)?.groups?.jobId
        : undefined;
    if (jobId) {
      // ponytail: the tag is the instance's, not the request's, so a second job POSTed while one runs (the container
      // refuses it) re-tags the running job's last calls. The Talker runs one build per turn.
      await this.setOutboundByHost(MODELS_HOST, "models", {
        draftId: this.draftId,
        jobId,
      } satisfies ModelCallParams);
    }
    const response = await this.containerFetch(request);
    // Past max_instances no container starts: the Talker reads that as a busy build (#122).
    if (jobId && response.status === 503) {
      return new Response(
        `${JSON.stringify({ reason: "busy", type: "failed" })}\n`,
        { headers: { "content-type": "application/x-ndjson" } }
      );
    }
    return response;
  }
}
