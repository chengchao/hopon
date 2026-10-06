# 1. Migrate the API to Effect, one route at a time

## Status

Accepted. In progress.

## Decision

The API (`apps/api`) moves to Effect v4 (`effect` on npm, source in `repos/effect`) in small slices. Each slice leaves `pnpm check` green, and the worker tests in `apps/api/test/worker.test.js` call the Worker over HTTP, so they don't change between slices.

During the migration, Hono stays the HTTP shell: routing, `bodyLimit`, headers, `onError`. Route bodies become `Effect.gen` and are run with `Effect.runPromise`. This is Effect's own documented bridge (`repos/effect/ai-docs/src/04_integration/10_managed-runtime.ts`). Errors are `HttpError` (`apps/api/src/game.ts`), which Hono code throws and Effect code yields. `app.onError` renders both, because `runPromise` rejects with the failure itself. Database calls go through `Effect.promise`, so a D1 failure becomes a defect and returns a 500, as it does today.

## Order

1. Done: generation (`POST /api/games`). The AI output is decoded with Schema, and `Effect.timeoutOrElse` replaces the hand-rolled timer.
2. Done: every route. `run(c, effect)` provides the `Db` and `Viewer` services from the Hono context. Middleware (session, body validation, body limit) stays in Hono until step 3.
3. Replace Hono with `effect/http-api`. This also moves the request and response schemas in `packages/schemas` from zod to Effect Schema, so mobile changes in the same step.
4. Optionally, replace Drizzle with `@effect/sql-d1`.

## Why not all at once

Step 3 changes what mobile imports. Steps 1 and 2 bring Effect's typed errors, timeouts, and Schema in without touching mobile, and each one is small enough to review.
