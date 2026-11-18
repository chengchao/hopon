# P2 trail: the ask_advisor tool

The decisions behind P2 of `maker-single-agent-vite.md`, in order. Each names what it changed and its evidence.

## Build

- **Branch.** `claude/p2-ask-advisor` from `claude/p1-single-agent` at `9ccae2a`.
- **Where the transcript comes from.** A tool's `api` has no context read, but pi's `Conversation.context()` returns the committed model context, the messages the agent's next call would send. The tool opens it through `PiHarness.pi()`, by `api.conversationId`. The `ask_advisor` call's own assistant message is in it; its result isn't yet.
- **The transcript goes as text, in one user message.** The advisor's request has no `tools`, and Anthropic's API refuses `tool_use` and `tool_result` blocks without them. Text also drops the agent's thinking blocks, which only the model that wrote them can read. Roles are `USER`, `MAKER` and `RESULT of <tool>`. Tool calls go whole, so the advisor sees the code the agent wrote and the agent never pastes it. Tool results are cut at 4,000 characters, since skills and logs are long and the start is what matters. Images become `[image]`.
- **The model goes through `api.models`.** `piModels` gets a second provider, `advisor`, on `MAKER_ADVISOR_MODEL`, with the same `modelFetch` route and gateway metadata (`agent: "maker"`, the Draft id). The tool calls `api.models.completeSimple` at reasoning `medium` and 16,000 max tokens.
- **Fable 5.2 isn't in pi-ai 1.4.0's catalog.** It stops at Fable 5.1. `pi-models.ts` adds `claude-fable-5-2` as 5.1's descriptor at Anthropic's 5.2 price, $8 / $40 a million, cache reads $0.20 (from the claude-api skill's model table, cached 2026-11-03). Cache writes at $10 are inferred as 1.25 times input. An unknown model id now throws at load.
- **Cost.** The tool charges `usage.cost.total` with `chargeCall`, the function `metered` now shares, and returns the usage on the result so pi counts it under the tool.
- **The Allowance.** The tool checks the Allowance before the call, with the check `begin` used, now `Maker.allowed()`. At or below zero it returns the `used-up` result, and the agent says only that line. Above zero the call runs even if it overshoots, as ADR 0004 lets any started work finish.
- **Errors.** A failed call (pi-ai's `stopReason` `error` or `aborted`) returns the new `advisor-failed` result with `isError`, and the run goes on. A throw also becomes pi's error result.
- **The skill.** `make-game` gains "Asking the advisor": the four moments, at most two calls a run unless stuck, none for a small clear change. The skills fingerprint goes to `v8`.
- **Not done.** `ask_advisor` passes the `limits` hook like any tool, so it counts as a step and its first call of a run starts the box. Splitting it out would add a branch for a cost of seconds.

## Verify, unit

- `apps/worker/test/maker.test.js` "ask_advisor": the fake gateway sees one advisor request with no `tools`, the system prompt, the Creator's message, the agent's `write` call and the question. The advice is the tool result, and the run cost 4,000 hopon tokens, the agent's three calls and the advisor's. A 400 from the advisor returns `advisor-failed` and the agent's next `write` runs.
- The allowance test gains a third week: with 1,500 left, the run starts, the advisor call finds the Allowance below zero, the reply is the used-up line, and the gateway sees no advisor request.

## Verify, live

- **Preview.** `https://claude-p2-ask-advisor-hopon.calendeam.workers.dev`, deployed at `2491d3d`. CI green.
- **Lane 2, saves.** Draft `94bb6233…`. The agent declined saves kindly without a build and without the advisor: `maker.md` already rules saves out, and the skill, where the advisor's moments live, loads only for a build. On "Yes, build it." it built Coin Cart (Revision 1, a shop of in-run upgrades) with no advisor call. Fails the lane's letter (no advisor call), meets its intent (a kind decline, no saves).
- **Draft room.** The eval user is at 20 of 20 Drafts, so the other lanes wait for the operator's room.

## The done check on every build

- **The operator's call.** The fourth moment was narrowed to complex new games, on a guess at cost. The operator restored it as specified: every game the agent is about to report done, new or change, gets the advisor's check for omissions and obvious problems. Narrow it only if the eval shows cost over 130% of P1's.
- **Where it sits.** A new workflow step 8, before `build`: after the playtest, verify and the agent's own tests (`node /opt/hopon/playtest.js tests`) pass. A successful `build` writes a Revision, so advice taken after it would cost a second `build` and a second Revision. Before it, a fix costs a playtest and a test run, and `build` still gates the result. A `build` that fails after the check is fixed and retried without a second check.
- **The cap.** At most two calls a run, the done check included, so one call is left for a design choice or a large change. Calls when stuck don't count. A small, clear change gets no advice before it, only the done check.
- **The skills fingerprint goes to `v9`.** The Preview served `v8` with the old section, and a Draft whose recorded fingerprint matches keeps its seeded skills.
- **The e2e sweep's dollars.** `apps/maker/eval/preview.ts` summed only assistant messages' `usage.cost.total`. The advisor's usage sits on the `ask_advisor` tool result (pi's `appendToolResult` copies a tool's `usage` onto the `toolResult` message), so a sweep left it out. Each `tool_execution_end` whose result carries a cost now adds it to the turn and to the run's messages, so it lands in the build's cost when it comes before the build ends and in the reply's otherwise. Output tokens stay the agent's. No test file covers `preview.ts`.

## Fix round

- **A run that crosses zero still builds.** The used-up line from `ask_advisor` told the agent to say only that line, so a run that crossed zero before its done check stopped short of `build`: the Creator paid for the run and got no Revision. ADR 0004 lets started work finish. With the Allowance used up, the tool now asks no one and returns `no-advice` ("wasn't asked"), which tells the agent to go on and call `build`. The run's own limits still apply. The allowance test's third week now runs `advisedbuild` and gets Revision 2.
- **One result for no advice.** `advisor-failed` became `no-advice` with a reason: not asked, unavailable, couldn't answer, or gave no advice. Each says to go on and call `build` when the game is ready.
- **The four moments live in the tool's description.** The operator kept them advisory, not enforced. The description goes to the model with every call, whether or not `make-game` is loaded; the lane-2 Draft never loaded it and never asked. The description names the moments and the two-call cap. The skill's section keeps only what the description leaves out: why the done check comes before `build`, what counts as a hard choice or a large change, and to go on after a `no-advice`. The skills fingerprint goes to `v10`.
- **No cache write.** The advisor's request is one call nothing reads back, so a cache write only costs 1.25 times input. pi-ai 1.4.0's `cacheRetention: "none"` (`StreamOptions`, mapped in `api/anthropic-messages.js` `getCacheControl`) drops `cache_control`. The test asserts the request has none.
- **No empty advice.** pi-ai maps Anthropic's `refusal` to `stopReason` `error`, already handled. A `max_tokens` stop can come back with thinking and no text; an empty answer now returns `no-advice` ("gave no advice: it stopped on length").
- **An unknown advisor model fails only the advisor.** `piModels` threw at load on any model pi-ai doesn't know, so a mistyped `MAKER_ADVISOR_MODEL` took the whole Maker down (measured: the test's `/api/drafts` answers 500 at `372b40e`). It now logs and leaves that model out. `ask_advisor` finds no model, logs, and returns `no-advice` ("is unavailable"). The agent's own model unknown now fails at its first call instead of at load.
- **No stand-in result.** pi's context gives the running `ask_advisor` call a stand-in error result, "Tool result unavailable: history ends before this call completed." The advisor saw it as `RESULT of ask_advisor (error)`. `render` drops results whose `details.reason` is `missing_result`.
- **Screenshots.** The advisor's prompt now says screenshots reach it only as `[image]`, so it judges looks from the code and behavior from the tests and the playtest's text.
