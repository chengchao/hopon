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
