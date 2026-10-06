# 1. Migrate the API to Effect, one route at a time

## Status

Accepted. Steps 1 and 2 are done; steps 3 and 4 are deferred.

## Decision

The API (`apps/api`) moves to Effect v4 (`effect` on npm, source in `repos/effect`) in small slices. Each slice leaves `pnpm check` green, and the worker tests in `apps/api/test/worker.test.js` call the Worker over HTTP, so they don't change between slices.

Hono stays the HTTP shell: routing, `bodyLimit`, headers, `onError`. Route bodies are `Effect.gen` and are run with `Effect.runPromise`. This is Effect's own documented bridge (`repos/effect/ai-docs/src/04_integration/10_managed-runtime.ts`). Errors are `HttpError` (`apps/api/src/game.ts`), which Hono code throws and Effect code yields. `app.onError` renders both, because `runPromise` rejects with the failure itself. Database calls go through `Effect.promise`, so a D1 failure becomes a defect and returns a 500.

## Order

1. Done: generation (`POST /api/games`). The AI output is decoded with Schema, and `Effect.timeoutOrElse` replaces the hand-rolled timer.
2. Done: every route. `run(c, effect)` provides the `Db` and `Viewer` services from the Hono context. Middleware (session, body validation, body limit) stays in Hono.
3. Deferred: replace Hono with `effect/http-api`. This would also move the request and response schemas in `packages/schemas` from zod to Effect Schema, so mobile would change in the same step.
4. Deferred: replace Drizzle with `@effect/sql-d1`.

## Why step 3 is deferred

- **Not stable.** In `effect` 4.0.1, `HttpApi`, `HttpApiBuilder`, `HttpApiClient` and `HttpRouter` are marked `@stability unstable`, even though they no longer sit under an `unstable/` path. Hono is stable.
- **Little left to gain.** The API already checks every response against the shared types in `packages/schemas` with `satisfies`, and mobile enables Post and Make from the same zod rules the API uses. The remaining gap is that `api<T>(path)` in `apps/mobile/lib/api.ts` doesn't tie `path` to `T`.
- **Real cost.** A typed `HttpApiClient` would put the Effect runtime in the mobile bundle, where today only `zod/mini` runs, for two `safeParse` checks. Every behaviour of the Hono shell would also need rebuilding and re-testing: the `{ error }` body, the 413 and 415 handling, the custom 400 messages (HttpApi's decode errors have their own format), the CSP headers and the `:id` pattern.

Steps 1 and 2 already brought in what Effect is for here: typed errors, timeouts, Schema for the AI output, and services.

## Revisit when

- `effect/http-api` is marked stable, or
- a second client (such as a web app) needs the API, or
- we want generated OpenAPI docs.

Any of these makes one shared API definition worth the rewrite.
