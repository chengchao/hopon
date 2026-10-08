# Coding standards

Judgement calls a reviewer checks in a diff. Anything a fixed pattern can catch belongs in oxlint or a test instead (see `apps/api/test/sql-subqueries.test.js`).

## App (`apps/mobile`)

- **Stale responses.** After an `await`, a component whose target can change while the request is in flight (the open game, the selected item, the signed-in user) confirms the target is still current before it sets state. Effects that apply to the right record regardless, like a feed count keyed by game id, still run.
- **Modal hand-off.** A screen opens once the RN `Modal` above it has finished dismissing: from `onDismiss` on iOS, immediately on Android.
- **Auth readiness.** Code branches on Clerk's `user` (for example, "has a Handle") only after `isLoaded`.
- **One count.** Client-side limits count the way the server does (characters via `[...text]`, matching SQLite `length()`), so the client never blocks what the server accepts.

## API (`apps/api`)

- **Not found, not forbidden.** A request for a record hidden from the viewer (someone else's draft, a comment you can't delete, a game across a Block) gets the same `404` and message as a missing one.

## Both

- **Glossary words.** User-facing copy and new names use the terms in `GLOSSARY.md`.
