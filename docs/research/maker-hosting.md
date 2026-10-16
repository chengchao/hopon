# Where the Maker runs: Cloudflare Containers or Fly Machines

Research for [#112](https://github.com/chengchao/hopon/issues/112), part of map [#111](https://github.com/chengchao/hopon/issues/111). Researched 2026-10-16.

**Question:** The Maker is one Node container (pi-coding-agent, the model key, the E2B token). It must hold a ~5-minute SSE stream behind the Worker, reach E2B and the AI Gateway outbound, restart safely (state is snapshotted to R2 each turn) and deploy from CI (#37). Cloudflare Containers or Fly Machines?

**Short answer: Cloudflare Containers.** Both platforms can do the job. Cloudflare wins because the Maker then lives inside the Worker that already is hopon's whole app surface: one `wrangler deploy` ships Worker and container together with the `CLOUDFLARE_API_TOKEN` that #37 needs anyway, the Worker reaches the container through a Durable Object binding with no public ingress and no second auth scheme, and secrets are the Worker's own `wrangler secret put`. Fly would add a second vendor, a second CLI and token, a second bill, a public hostname the Worker has to authenticate to, and a proxy whose idle-stop semantics for an open stream are not documented. Nothing in Fly's favour (slightly cheaper, more mature) outweighs that for one container at ~10 sessions.

The facts that decided it, each with its source, are in the sections below. Every claim is from the vendor's own docs; where the docs are silent, it says so.

## 1. Long-lived HTTP streams through the Worker

**Cloudflare.** A Worker's HTTP request has no hard duration limit while the client stays connected, and "A Worker that is still streaming a response body remains active" ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). Durable Object requests are likewise "Unlimited" with "No hard limit while the caller stays connected" (same page). The Worker reaches a container only through a Durable Object (`ctx.container`), and end users can only send HTTP, not raw TCP ([architecture](https://developers.cloudflare.com/containers/platform-details/architecture/)). The `Container` class's `fetch()` forwards to the container's port and "Incoming requests keep the container alive automatically"; background work can call `renewActivityTimeout()` ([container package](https://developers.cloudflare.com/containers/container-package/)). The WebSocket example shows the same path holding an upgraded socket open, with the note that an open connection keeps the Durable Object active ([example](https://developers.cloudflare.com/containers/examples/websocket/)). The docs never name SSE specifically; it is an ordinary streamed response body, which the Workers and DO limits cover. **A 5-minute SSE turn is within documented limits at every hop.**

**Fly.** The Worker would `fetch()` a public Fly hostname; the Workers side is the same "Unlimited" streaming. On Fly's side the proxy "normalizes HTTP connections and sends HTTP 1.1 requests to the application process" ([services](https://docs.fly.io/networking/services/)). `idle_timeout` under `[http_service.http_options]` configures "an idle-timeout for connections to your app"; the example value is `600` and no default is stated ([configuration](https://docs.fly.io/reference/configuration/)). No maximum request duration is documented. **Workable, but the idle timeout must be set and the default is undocumented.**

## 2. Instance lifetime, sleep and restarts

**Cloudflare.** "Cloudflare does not stop a container instance after a fixed maximum runtime," but "Platform events, such as host restarts, can stop instances at any time," and Cloudflare "doesn't guarantee that any instance will run for a set period" ([FAQ](https://developers.cloudflare.com/containers/faq/)). The `Container` class sleeps an instance after `sleepAfter` of no traffic, default 10 minutes; the next `fetch()` restarts it ([container package](https://developers.cloudflare.com/containers/container-package/)). Shutdown is SIGTERM, up to 15 minutes to drain, then SIGKILL ([architecture](https://developers.cloudflare.com/containers/platform-details/architecture/)). A deploy that changes the image replaces running instances with the same SIGTERM sequence; `rollout_active_grace_period` (default 0) can skip instances that talked to their DO within N seconds ([rollouts](https://developers.cloudflare.com/containers/platform-details/rollouts/)). Disk is ephemeral; DO storage persists across restarts. Out-of-memory restarts the instance; no swap ([FAQ](https://developers.cloudflare.com/containers/faq/)).

**Fly.** Restart policy per Machine: `on-failure` (default, restart on non-zero exit, up to `max_retries`=10 in 5 minutes), `always`, `no` ([restart policy](https://docs.fly.io/machines/guides-examples/machine-restart-policy)). `auto_stop_machines` (`off` default, `stop`, `suspend`) lets the proxy stop an idle Machine; a single Machine in a region is stopped when it has "a load of 0"; the loop runs "every few minutes" ([autostop/autostart](https://docs.fly.io/launch/autostop-autostart), [how it works](https://docs.fly.io/reference/fly-proxy-autostop-autostart)). The reference page does not define "load" nor say whether an open HTTP connection blocks a stop. `kill_timeout` is 5 s by default, max 300 s, "best-effort" ([configuration](https://docs.fly.io/reference/configuration/)). `fly secrets set` restarts every Machine (see section 5).

**Both require the same thing of the Maker:** handle SIGTERM, keep no state that is not already in R2, and let the client reconnect. ADR 0003 already snapshots per turn, so this is a wash. Cloudflare's "may stop at any time" is the louder warning; Fly's 5 s default kill window is the sharper edge, and its secret rotation restarts the box.

## 3. Cold start

- Cloudflare: "often 1 to 3 seconds, depending on image size and startup code"; the instance may land in a different location after a restart ([architecture](https://developers.cloudflare.com/containers/platform-details/architecture/), [FAQ](https://developers.cloudflare.com/containers/faq/)).
- Fly: stopped Machines "take about 2 seconds or more to start"; suspended ones resume "in a few hundred milliseconds" ([autostop/autostart](https://docs.fly.io/launch/autostop-autostart)).

Fly's suspend is faster; a one-off 1–3 s before a multi-minute turn does not matter to the Maker. Both are "scale to zero" when idle.

## 4. Outbound network (E2B, AI Gateway)

- Cloudflare: "By default, a Container will allow internet access." `enableInternet=false` restricts to ports 80/443 through Worker-side handlers, and `allowedHosts` gives a deny-by-default allowlist ([outbound traffic](https://developers.cloudflare.com/containers/platform-details/outbound-traffic/)). That lets the Maker be pinned to `api.e2b.dev` and `gateway.ai.cloudflare.com`, a useful guard for a box holding the model key. AI Gateway is a plain HTTPS endpoint, `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/{provider}`, keeping "the original provider's API schema" ([AI Gateway](https://developers.cloudflare.com/ai-gateway/get-started/)). E2B is used through its SDK over HTTPS ([lifecycle](https://docs.e2b.dev/sandbox/lifecycle)).
- Fly: ordinary outbound internet from the Machine; egress billed per GB (section 6). No allowlist feature in the docs read.

No difference for reachability. Cloudflare has the allowlist.

## 5. Secrets

- Cloudflare: `wrangler secret put` on the Worker, read in the Durable Object and passed to the container as `env` on `start()`; "A running process keeps its startup environment," so a rotated secret reaches the container on its next start ([env vars and secrets example](https://developers.cloudflare.com/containers/examples/env-vars-and-secrets/)). This is the same mechanism `apps/api/wrangler.jsonc` already declares under `secrets.required`.
- Fly: `fly secrets set` writes an encrypted vault and "restarts each Machine in the app"; `--stage` defers to the next deploy; the host agent injects them as env vars at boot ([secrets](https://docs.fly.io/reference/secrets)).

Cloudflare keeps one secret store and one rotation path for Worker and Maker. On Fly the Worker also needs a shared token to authenticate itself to the Maker's public hostname, a secret that exists only because of the split.

## 6. Pricing at ~10 concurrent sessions

Assume one always-on instance for a month (730 h); scale-to-zero only lowers both.

**Cloudflare** ([pricing](https://developers.cloudflare.com/containers/pricing/), [limits](https://developers.cloudflare.com/containers/platform-details/limits/)). Needs Workers Paid ($5/month), which the API already requires. Billed per 10 ms while running: memory $0.0000025/GiB-s (25 GiB-h included), CPU $0.000020/vCPU-s on active use only (375 vCPU-min included), disk $0.00000007/GB-s (200 GB-h included). Egress NA/EU $0.025/GB after 1 TB.

| Instance | vCPU / memory / disk | Memory + disk, always on | Notes |
| --- | --- | --- | --- |
| basic | 1/4 / 1 GiB / 4 GB | ~$6.3 + ~$0.7 | tight for Node + 10 agent loops |
| standard-1 | 1/2 / 4 GiB / 8 GB | ~$26.1 + ~$1.4 | suggested start |
| standard-2 | 1 / 6 GiB / 12 GB | ~$39.2 + ~$2.2 |  |

CPU is extra and usage-based: the Maker mostly waits on the model and E2B, so expect minutes, not hours, of vCPU per day. A fully busy half vCPU for a month would add ~$26 on standard-1; realistic use is a fraction of that.

**Fly** ([pricing](https://docs.fly.io/about/pricing), `iad`/`ewr` rates). No platform fee; credit card required; no free tier (2-hour trial). Stopped Machines bill rootfs at $0.15/GB-month. Egress NA/EU $0.02/GB.

| Preset         | RAM  | Always on |
| -------------- | ---- | --------- |
| shared-cpu-1x  | 2 GB | $12.70    |
| shared-cpu-2x  | 2 GB | $13.39    |
| shared-cpu-2x  | 4 GB | $25.40    |
| performance-1x | 2 GB | $33.00    |

Comparable size costs the same (~$25–28/month either way); Fly's shared 2 GB tier is cheaper if 2 GB suffices. Tens of dollars a month either way; not decisive.

## 7. Deploy from CI (#37)

**Cloudflare.** `wrangler deploy` uploads the Worker, then builds the image with local Docker and pushes it to Cloudflare's registry, then starts a rollout ([image management](https://developers.cloudflare.com/containers/platform-details/image-management/), [deploy guide](https://developers.cloudflare.com/containers/guides/deploy/)). Docker is required at deploy time when `image` is a Dockerfile; GitHub's `ubuntu-latest` runners ship Docker, and `wrangler-action@v4` takes the same `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` that #37 plans ([GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)). Caveats: Worker and container steps "aren't transactional"; "Deploy success means the rollout started"; a non-production `wrangler deploy` can roll out containers under production traffic, so staging must be a separate Worker or Wrangler environment (which #37 adds anyway) ([deploy guide](https://developers.cloudflare.com/containers/guides/deploy/), [rollouts](https://developers.cloudflare.com/containers/platform-details/rollouts/)).

**Fly.** `superfly/flyctl-actions/setup-flyctl` plus `flyctl deploy --remote-only` with a `FLY_API_TOKEN` from `flyctl tokens create deploy` ([GitHub Actions](https://docs.fly.io/launch/continuous-deployment-with-github-actions)). `--remote-only` builds on a remote builder, so no Docker on the runner ([flyctl deploy](https://docs.fly.io/flyctl/deploy)). Deploy strategies `rolling` (default), `immediate`, `canary`, `bluegreen` ([configuration](https://docs.fly.io/reference/configuration/)). This is a second deploy job with a second token, and the Worker's `MAKER_URL` and shared token must be kept in step with it.

## 8. Scheduling policy and the "one container" shape

Cloudflare has two policies, fixed at application creation ([scheduling policy](https://developers.cloudflare.com/containers/configuration/scheduling-policy/)):

- `default`: one image and `instance_type` in Wrangler, `max_instances` supported, application-wide rollouts. The `@cloudflare/containers` `Container` class works only with this policy ([container package](https://developers.cloudflare.com/containers/container-package/)).
- `durable_object` (beta): image and size chosen at `ctx.container.start()`, snapshots, SSH; no rollouts, no `max_instances`.

For the Maker use `default` with `max_instances: 1`, one named Durable Object (`getByName("maker")`), and the `Container` class. Per-session state stays in R2 per ADR 0003, so the single DO is only a router and a lifecycle owner. Account limits (6 TiB memory, 1,500 vCPU concurrent) are far above one instance ([limits](https://developers.cloudflare.com/containers/platform-details/limits/)).

## 9. Risks of the recommendation

- Cloudflare may stop the instance at any time and gives no location guarantee after a restart. Mitigated by the per-turn R2 snapshot and client reconnect that ADR 0003 already requires.
- Containers has no built-in autoscaling yet ([FAQ](https://developers.cloudflare.com/containers/faq/)). Irrelevant at one instance; if the Maker ever needs more than one box, routing is by DO name, which is the natural per-Draft key.
- Deploy is non-transactional and the rollout replaces the running box mid-turn unless `rollout_active_grace_period` is set. Set it to at least the 5-minute turn limit (300 s).
- Memory is provisioned, so pick the instance type by measurement: start at standard-1, drop to basic if 10 concurrent pi-coding-agent loops fit in 1 GiB.

## Fallback

If Cloudflare Containers fails in practice (for example SSE through the DO proves flaky), Fly's `shared-cpu-2x` 4 GB at $25.40/month with `auto_stop_machines = "suspend"`, `idle_timeout = 600`, `kill_timeout = 300` and a bearer token checked by the Maker is the drop-in. The Maker's own code does not change; only the Worker's proxy hop and the CI job do.
