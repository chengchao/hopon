# Debugging a Worker Preview

A Preview has no logs to read yet: `wrangler tail` sees only production, and Workers Observability is off until #35. Read the Preview's **state** instead: per-object statuses, its namespace ids, its container instances. Every recipe below runs with wrangler's own OAuth token, `T=$(npx wrangler auth token | tail -1)` (from `apps/worker`), and the account `A=51a5a41f7bd8425703a6f1d92f867f4d`. A Preview's slug is its branch with `/` as `-`.

## Which Durable Objects failed

GraphQL `durableObjectsInvocationsAdaptiveGroups`, filtered by `scriptName: "hopon"` and a `status` (`internalError`, `success`, …), gives each object's requests by namespace. `orderBy` takes no `count_*` value; leave it out.

```bash
S=$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ); E=$(date -u +%Y-%m-%dT%H:%M:%SZ)
curl -s https://api.cloudflare.com/client/v4/graphql -H "Authorization: Bearer $T" -d "{\"query\":\"{ viewer { accounts(filter:{accountTag:\\\"$A\\\"}) { durableObjectsInvocationsAdaptiveGroups(limit:20, filter:{datetime_geq:\\\"$S\\\", datetime_leq:\\\"$E\\\", scriptName:\\\"hopon\\\", status:\\\"internalError\\\"}) { sum { requests } dimensions { namespaceId objectId status } } } } }\"}"
```

For the Worker itself, `workersInvocationsAdaptive` with `isPreview: 1`.

## Which namespace is the Preview's

Each Preview has its own Talker and Coder namespaces, so the GraphQL rows mix production's and every Preview's. The Preview's latest deployment names its own at `.result.env.TALKER.namespace_id` and `.result.env.CODER.namespace_id`:

```bash
curl -s "https://api.cloudflare.com/client/v4/accounts/$A/workers/workers/hopon/previews/<slug>/deployments/latest" -H "Authorization: Bearer $T"
```

## Who holds the Coder containers

A Preview's container app is `hopon_<slug>_Coder`, capped at `max_instances: 2`. Get the app id from `wrangler containers list`, then:

- `wrangler containers instances <app id>` lists the instances Coder objects hold; an instance's id is its Coder's object id. When every instance is held, a new Draft's build gets none.
- `wrangler containers info <app id>` reports `active` and `assigned` health counts, which don't say who holds an instance. Read `instances` for that.

Run both with `CLOUDFLARE_ACCOUNT_ID=$A`.

## Driving a Preview as the Creator

`eval e2e --preview <url>` (`apps/maker/eval/README.md`) signs in as the eval's Clerk Development user and drives a whole chat. For a single route, import `signIn` from `apps/maker/eval/preview.ts` and `fetch` the route with its token. The user has 10 builds per UTC day; the README has the SQL that resets them.
