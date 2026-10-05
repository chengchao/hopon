# TanStack Start + Cloudflare verification

> 2026-10-04: the TanStack Start web front end described here was replaced by the Expo app. The Cloudflare, D1 and Workers AI findings still apply.

Initial documentation research: 2026-09-09. Subsequent live inference and deployment findings are recorded below.

## Minimal React setup

Install `@tanstack/react-start`, `@tanstack/react-router`, `react`, `react-dom`; development dependencies are `vite`, `@vitejs/plugin-react`, `@cloudflare/vite-plugin`, `wrangler`, and TypeScript/types if using TS. Start generates the route tree; retain only the root route, index route and router required by this application. [TanStack build from scratch](https://tanstack.com/start/latest/docs/framework/react/build-from-scratch)

```js
import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [cloudflare({ viteEnvironment: { name: 'ssr' } }), tanstackStart(), react()],
});
```

Use `vite dev`, `vite build`, `vite preview`, and `vite build && wrangler deploy`. Wrangler needs `nodejs_compat` and a current compatibility date; preserve this project's D1 and AI bindings. Cloudflare explicitly supports a custom `src/server.ts` (or JS equivalent) as Wrangler `main`. [Cloudflare TanStack Start guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/)

The following adaptation preserves the existing API handler without adding another router:

```js
import handler from '@tanstack/react-start/server-entry';
import api from './worker.js';

export default {
  fetch(request, env) {
    return new URL(request.url).pathname.startsWith('/api/') ? api.fetch(request, env) : handler.fetch(request);
  },
};
```

This routing branch is a project-specific adaptation of the documented handler. Start's second fetch argument is `RequestOptions`, not Worker bindings; do not pass raw `env` into `handler.fetch`. Server functions can independently import `env` from `cloudflare:workers` if needed. [TanStack server entry](https://tanstack.com/start/latest/docs/framework/react/guide/server-entry-point), [Cloudflare bindings](https://developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/#bindings)

## Workers AI response contract

`@cf/qwen/qwen3-30b-a3b-fp8` accepts `messages`, `max_tokens` and `response_format`. Its current synchronous output schema is an OpenAI-style `chat.completion` with `choices`, so generated text belongs at `result.choices[0].message.content`, not the older model-specific `result.response`. `max_tokens` defaults to 2,000; the published schema does not state an upper bound. The listed context window is 32,768 tokens. Thus 10,000 output tokens is a deliberate application setting, not a verified provider maximum; it still needs live validation. [Cloudflare model specification](https://developers.cloudflare.com/ai/models/%40cf/qwen/qwen3-30b-a3b-fp8/)

Requesting JSON output does not replace server validation; Cloudflare documents that schema compliance is not guaranteed. Keep the existing title/description/HTML validation and incomplete-output errors. [Cloudflare JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/)

## Live verification update

The first Qwen game failed a real gameplay check: its card renderer exposed hidden answers and its turn state reset prematurely. Switched to `@cf/zai-org/glm-4.7-flash` and added general state-transition, hidden-information and responsive-input requirements to the system prompt. GLM uses the same `choices[0].message.content` contract and accepts `max_completion_tokens`, `reasoning_effort` and structured response formatting. [Official GLM model schema](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/)

The product UI and generated-game instructions now use English, per the user’s explicit preference.

GLM also produced an unusable global CSS rule during live validation. The final default is `@cf/moonshotai/kimi-k2.7-code`, with `max_completion_tokens: 12000`, low reasoning effort and `chat_template_kwargs.enable_thinking: false`. The generated Ocean Memory game passed browser checks for hidden cards, mismatch reset, matching pairs, score, win, restart and publishing. Cloudflare documents these controls in its [official provider source](https://github.com/cloudflare/ai/blob/main/packages/workers-ai-provider/README.md#reasoning-controls). The request timeout is 180 seconds.

## Completion audit, 2026-09-09

The deployed app uses Workers, D1 and Workers AI. Public `/api/games` contains the published Ocean Memory game. Browser verification confirmed that it is followed by Toast Panic and Odd Duck, and scrolling the description advances the feed. The current nine tests pass, including ownership, output validation, quota, pagination, first-publication feed preservation, swipe settling, and microgame outcomes. The latest application build and TypeScript check passed before deployment.

A fresh production request for an English five-tap microgame returned HTTP 504 with `Generation took too long. Please try again.` at the configured inference deadline. This is a live provider-path failure, not a mocked test result. No test game was published. The existing successful public game proves that generation has worked, but this new timeout leaves generation latency/reliability unresolved; the full goal is not yet marked complete.

## Reasoning diagnosis, 2026-09-10 UTC

The earlier claim that `enable_thinking: false` disables K2.7 Code reasoning was incorrect. A saved response contained 37,520 reasoning characters versus 6,572 output characters. A new streamed baseline completed in 101.5 seconds with 2,191 reasoning characters and 12,760 output characters. Setting `reasoning_effort: null` still emitted reasoning; that diagnostic request was stopped once the hypothesis was disproven.

The [official K2.7 Code template](https://huggingface.co/moonshotai/Kimi-K2.7-Code/blob/main/chat_template.jinja) unconditionally begins a thinking block. The [K2.5 template](https://huggingface.co/moonshotai/Kimi-K2.5/blob/main/chat_template.jinja) supports the model-specific `thinking: false` parameter. A K2.5 diagnostic with `chat_template_kwargs: { thinking: false }` emits zero reasoning characters. This comparison is a configuration diagnosis, not a statistical benchmark or latency guarantee.

The K2.5 diagnostic completed with valid JSON in 141.1 seconds and zero reasoning characters. Its unmodified Button Sprint HTML was previewed under the same CSP as published games: browser checks observed timeout, restart back to the start screen, countdown, five taps, and the win screen. Production now uses K2.5 with `chat_template_kwargs: { thinking: false }`, a 6,000-token completion ceiling and an 8,000-character HTML target in the prompt. The previous model remains documented as historical investigation, not the current default. Ten tests and the client/Worker build plus TypeScript check pass. Deployed version: `754628ba-3467-4910-9bde-af18386905aa`.

### Final verification

With the deployed K2.5 configuration, a fresh production natural-language request created private Button Sprint draft #2 in 110.972 seconds (HTTP 201). Its owner document returned 200 with the game CSP; an unauthenticated request returned 404. Its inline JavaScript parsed successfully. The exact returned HTML, without edits, was then served locally under that same CSP for browser verification: START, five-second timeout, Play Again reset, five taps, and YOU WIN with 5/5 all worked. The test draft remains unpublished; the existing published Ocean Memory and the two labeled originals remain the public feed.

| Requirement                         | Authoritative evidence                                                                                                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Natural-language creation           | Deployed POST `/api/games` produced Button Sprint from an English gameplay prompt, saved in D1; exact output passed browser win/loss/retry checks.                                                              |
| Preview and publish                 | Owner-only document and publish checks pass against real SQLite; deployed Ocean Memory is publicly playable after publishing.                                                                                   |
| Browse other games vertically       | Deployed feed shows Ocean Memory, Toast Panic, Odd Duck. Browser scrolling the description advances a full game height. Drag and snap checks cover short and long gestures; game-area scrolling stays in place. |
| English UI                          | Source routes, game instructions, navigation, errors and rendered production pages are English.                                                                                                                 |
| Cloudflare stack and TanStack Start | Deployed Worker version `754628ba-3467-4910-9bde-af18386905aa`, D1 binding and Workers AI binding; TanStack client/SSR build and TypeScript check pass.                                                         |
| Minimal scope                       | Discover and Create routes only; no comments, likes, follows, rankings, payments or messaging.                                                                                                                  |
| Research and requested microgames   | UI research records Aippy/Sekai observations and the user's gesture correction. Toast Panic and Odd Duck are original short microgames with tested outcomes, not copies of Nintendo assets.                     |

All ten automated checks pass. The product's requested creation/publication/browsing flow is verified. Model generation remains stochastic: provider outages and malformed output are surfaced as errors, and preview-before-publish remains necessary; the observed 111 seconds is a measurement, not a service guarantee.
