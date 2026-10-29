# Coding standards

Judgement calls a reviewer checks in a diff. Anything a fixed pattern can catch belongs in oxlint or a test instead (see `apps/worker/test/sql-subqueries.test.js`).

## App (`apps/mobile`)

- **Stale responses.** After an `await`, a component whose target can change while the request is in flight (the open game, the selected item, the signed-in user) confirms the target is still current before it sets state. Effects that apply to the right record regardless, like a feed count keyed by game id, still run.
- **Modal hand-off.** A screen opens once the RN `Modal` above it has finished dismissing: from `onDismiss` on iOS, immediately on Android.
- **Auth readiness.** Code branches on Clerk's `user` (for example, "has a Handle") only after `isLoaded`.
- **One count.** Client-side limits count the way the server does (characters via `[...text]`, matching SQLite `length()`), so the client never blocks what the server accepts.

## Worker (`apps/worker`)

- **AI answers are untrusted.** Code that reads Workers AI output sends any shape it gets (`null`, a string, missing fields, nothing) down its failure path, not only the shapes the generated types promise, as `screen` does with Llama Guard's verdict. A `Schema` decode does that in one step.
- **Expand, then contract.** A migration's `-- contract: #<n>` names a merged PR whose code no longer reads what the migration drops or renames (`migrations.test.js` makes a dropping migration carry one); the PR that adds the migration never also stops reading it.
- **Not found, not forbidden.** A request for a record hidden from the viewer (someone else's draft, a comment you can't delete, a game across a Block) gets the same `404` and message as a missing one.

## Both

- **Glossary words.** User-facing copy and new names use the terms in `GLOSSARY.md`.
- **Fakes fail like the platform.** A test fake for a platform object (a Durable Object, a Container, R2) reproduces the failures the code under test meets on Cloudflare, not only the happy path: a Durable Object that resets as it's destroyed, a container that stops on SIGTERM or answers a non-2xx text body. `worker.test.js`'s fake Talker passed every Delete test while every real Delete returned 500 (#187).
- **Docs follow behaviour.** A diff that removes or changes what something does also updates the documents that describe it: skills under `.agents/skills/`, README steps, and the Status line of the ADR it builds.
