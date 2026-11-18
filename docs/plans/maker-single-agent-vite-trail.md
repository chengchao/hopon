# Maker single agent on Vite: decision trail

One row per decision or finished unit. Label: measured, inferred or guess.

| When (UTC) | PR | Decision or unit | Why | Evidence |
| --- | --- | --- | --- | --- |
| 2026-11-18 01:33 | P1 | Trunk baseline Preview from `claude/p1-baseline`: main plus one no-op file. | A push of main's own SHA matched no Deploy path, so no Preview deployed. | measured: Deploy run 44216717323 green. |
| 2026-11-18 01:37 | P1 | Stopped trunk sweep 1 and reported the Allowance to the root. | Bucket `user_3KGRLIkpqv8LbWNF1sh2oXUbPKW:2026-W47` read 78,437,356 of 80,000,000; four sweeps need about 72M. | measured: read-only SELECT. The root deleted the bucket with the operator's approval. |
| 2026-11-18 01:45 | P1 | The tool that publishes keeps the name `build`, with the prototype's `publish` arguments. | The app draws the game card from a `build` result and the status line from a running `build` (ADR 0005). Another name ships a regression to every installed app. | inferred from `apps/mobile/lib/maker-chat.ts`. |
| 2026-11-18 01:50 | P1 | Notes are stopped structurally: the socket strips text from any assistant message with a tool call and streams no text (`reply.ts`). The prompt also says so, with an example. | The prototype's prompt rule did not stop notes in eval replies. | measured: `src/reply.test.ts`, and the Maker test fails with the filter removed. |
| 2026-11-18 01:55 | P1 | `.hopon/asked.txt` holds every Creator message of the chat, not only the run's. `Music: none` must quote one of them. | A change turn after "no music" would otherwise fail verify and force music in. A quote works in any language, where a "no music" regex does not. | inferred; `apps/maker/image/verify.test.js`. |
| 2026-11-18 02:00 | P1 | The talker eval, `apps/maker/src/talker.ts` and `src/models.ts` go with `main-prompt.ts`. | They ran the main agent against a stub coder, which no longer exists. | measured: `pnpm check` green. |
| 2026-11-18 02:25 | P1 | `begin` brings the box up on every tool call of a run. | A box lost between calls let `build` publish the restored old Revision as new. | measured: the Maker test's lost-box and stopbox cases fail without it. |
| 2026-11-18 02:30 | P1 | Deleted my six leftover eval Drafts through the API, and run sweeps at concurrency 4. | Killed sweeps left Drafts, and the eval user hit the 20-Draft cap ("Delete a Draft to start a new one."). The older 13 Drafts are not mine and stay. | measured: GET /api/drafts. |
| 2026-11-18 02:31 | P1 | Deploy of c616bc0 failed with Cloudflare code 10013 on the Preview deployment POST. Retried on the next push. | previews.md has no entry for 10013. | measured: Deploy run 44217738520. |
