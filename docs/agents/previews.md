# Deploying and debugging a Worker Preview

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

## Who holds the Coder's boxes

Production's box app is `hopon-draftcoder` (`durable_object` policy). A Preview's is `hopon_<slug>_DraftCoder`: the same image under the default policy, `standard-3`, capped at `max_instances: 40` (`wrangler.jsonc` says why). Get an app's id from `wrangler containers list`, then:

- `wrangler containers instances <app id>` lists the running boxes; an instance's id is its Coder's object id. A Preview whose instances are all held fails new builds `busy`.
- `wrangler containers info <app id>` reports `active` and `assigned` health counts, which don't say whose a box is. Read `instances` for that.

Run both with `CLOUDFLARE_ACCOUNT_ID=$A`. Older Previews' `hopon_<slug>_Coder` apps are the old Container Coder's; delete them with `wrangler containers delete <id>`.

## When the deploy fails `DURABLE_OBJECT_NOT_CONTAINER_ENABLED`

The Preview's Durable Object namespace was created by an earlier deploy with no container, and Cloudflare won't add one to it. Delete the Preview, then rerun the deploy, which creates the namespace and its container app together:

```bash
npx wrangler preview delete --name <branch> --skip-confirmation
```

The Preview's Drafts go with it. In production the same refusal means a new class with a migration, as `DraftCoder` replaced `Coder`.

## Driving a Preview as the Creator

`eval e2e --preview <url>` (`apps/maker/eval/README.md`) signs in as the eval's Clerk Development user and drives a whole chat. For a single route, import `signIn` from `apps/maker/eval/preview.ts` and `fetch` the route with its token. The user has 10 builds per UTC day; the README has the SQL that resets them.
