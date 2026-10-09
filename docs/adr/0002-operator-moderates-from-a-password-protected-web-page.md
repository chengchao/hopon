# 2. The Operator moderates from a password-protected web page, not the app

## Status

Accepted, not built yet. Reverses the Operator parts of [#29](https://github.com/chengchao/hopon/issues/29): "API: Operator" (who the Operator is and how the API knows), the Operator's Reports row, queue and comment Delete under "App (Expo)", the `role` step under "Human-only steps", and user stories 50 and 66. Everything else the Operator can do (the queue's grouping and fields, Delete, Dismiss, Ban, the webhook) stays as #29 specifies.

## Context

#29 made the **Operator** a Clerk account with `publicMetadata.role = "operator"`, exposed as a `role` session claim. The API gates every Operator action on that claim (`operatorOnly` in `apps/api/src/index.ts`), and the Expo app shows the Operator a Reports row on Me, a queue (`apps/mobile/app/reports.tsx`) and Delete on any comment. That puts moderation tools inside the consumer app, and makes the Operator depend on two hand-made Clerk settings that every Clerk instance needs ([#72](https://github.com/chengchao/hopon/issues/72), [#32](https://github.com/chengchao/hopon/issues/32)). Neither ticket is done, so no deployed setup relies on the role yet.

## Decision

- **Where.** The Operator moderates from `/operator`, an HTML page served by the API Worker, like `/terms` and `/support`. Nothing about moderation stays in the app: no Reports row, no queue, no Operator Delete. In the app the Operator is an ordinary person, who can Report like anyone and then act on the page.
- **Who.** One password, the Worker secret `OPERATOR_PASSWORD`, checked with HTTP Basic auth on every `/operator/*` route. The username is ignored: Hono's `basicAuth` with a `username` option checks it too, so the check is `verifyUser` comparing only the password with `timingSafeEqual` (`hono/utils/buffer`, constant time). An unset or empty secret refuses everyone. The page needs no Clerk: Ban still calls Clerk's Backend API from the Worker with `CLERK_SECRET_KEY`.
- **Clerk no longer knows who the Operator is.** The `role` claim, `publicMetadata.role`, `Viewer.operator`, `operatorOnly` and the Operator branches of comment and game `DELETE` and of `canDelete` go. The queue, count, Dismiss, Ban and Operator Delete move from `/api/` to `/operator/`. The `/api/` middleware refuses writes without a Clerk session, and keeping `/api/` Clerk-only leaves one gate per path prefix.
- **Ban no longer refuses an Operator.** Its reason (story 66, "so that I can't lock myself out") is gone: banning the Operator's own hopon account doesn't touch the password. Ban still asks for confirmation first.
- **The page.** Server-rendered HTML with no JavaScript, from the same queries as today's `GET /api/reports`: open reports grouped by target, oldest first, with the snapshot, reasons with counts and whether the content is live. Each target has Play (a link to `/api/games/:id/document`), Delete, Dismiss and Ban as forms. Delete and Ban go through a confirmation page first, with the wording of the app's alerts. Each action redirects (303) back to the queue.
- **The webhook links to the page.** Each Report's webhook text ends with a link to its target on `/operator`, built from the request's origin, so the Operator can answer within 24 hours from a phone browser.

## Security

- **Password.** At least 32 random characters from a password generator. Nothing rate-limits requests yet ([#38](https://github.com/chengchao/hopon/issues/38)), so length is what stops guessing.
- **CSRF.** Browsers send Basic credentials automatically, even on a form another site submits, which Bearer tokens never are. Every `/operator/*` write goes through Hono's `csrf()`, which accepts `Sec-Fetch-Site: same-origin` or a matching `Origin`. A hand-written `Origin` check alone would refuse the page's own forms: the Worker sends `Referrer-Policy: no-referrer`, under which browsers send `Origin: null` even on same-origin form posts.
- **Clickjacking.** The page keeps `frame-ancestors 'none'`, as `PAGE_CSP` has.
- **Injected markup.** Snapshots are people's text shown on an authenticated page. They're escaped when rendered, and the page's CSP allows no script.
- **Playing a reported game.** Play is a top-level link to `/api/games/:id/document`, whose `GAME_CSP` (`sandbox allow-scripts`, `connect-src 'none'`, no forms) applies outside an iframe too. The game's HTML runs on an opaque origin with no network, so it can't reach `/operator`. No iframe, so the page's CSP needs no `frame-src`.
- **The password prompt.** `app.onError` renders every error that has a `status` as `{ error }` JSON. That would drop the `WWW-Authenticate` header `basicAuth` sends, and the browser would never ask for the password. Hono's `HTTPException` responses have to pass through unchanged.

These claims were checked before the ADR was accepted, with a throwaway script against the real Worker app and with Chromium (WebKit isn't available in that environment, so Safari wasn't checked). Today's `onError` turns `basicAuth`'s 401 into `{"error":""}` with no `WWW-Authenticate`. A same-origin form post from a `no-referrer` page arrives with `Origin: null` and `Sec-Fetch-Site: same-origin`, and `csrf()` accepts it. A form auto-submitted from another site arrives with the Basic credentials and `Sec-Fetch-Site: cross-site`, and `csrf()` refuses it. A game opened top-level under `GAME_CSP` runs on origin `null`, and neither its `fetch` nor its form POST reaches the server.

## Considered

- **Cloudflare Access** (email login instead of a password). hopon runs on `workers.dev` with no routes, and there Access protects the whole hostname, the app's API included.
- **A login form and a signed cookie.** Password managers fill it more reliably, and it stays signed in across days, but it needs about 40 more lines, plus expiry and logout. This is the fallback if Safari's Basic-auth prompt is painful on the phone.
- **Clerk sign-in on the page.** It needs Clerk's browser SDK and a frontend domain for the instance, and it keeps the manual Clerk steps this decision removes.
- **Keeping in-app comment Delete for the Operator.** This keeps the `role` claim and two ways to be the Operator for one shortcut.
- **Keeping a Ban guard** with an `OPERATOR_ACCOUNT` id secret, or with `publicMetadata.role` alone. Either guards against a mistake the confirmation page already catches, at the cost of one more thing to set on every Clerk instance.

## Consequences

- #72 loses the `role` step and gains `OPERATOR_PASSWORD`. #32 has no Operator step.
- The Worker tests call `/operator/*` with a Basic `Authorization` header and `Sec-Fetch-Site`, and check the 401 with `WWW-Authenticate`, the CSRF refusal and escaped snapshots. `sign()` loses its `role` claim.
- One shared password can't say which person did something, and can't be revoked for just one of them.

## Revisit when

- hopon moves to a custom domain with a route, where Cloudflare Access can cover `/operator` alone, or
- more than one person moderates.
