# 9. A message has no time limit

## Status

Proposed. Amends ADR 0006's limits per message and the 300 s in ADR 0008. ADR 0004's Allowance stays as it is. The step limit is 45 since 2026-11-22: a designed game with a scene for each screen spent 30 before it was done.

## Context

ADR 0006 gave each message 20 tool calls, 4 `build` calls and 5 minutes. Past any of them the Maker refused every tool, and the agent told the Creator it couldn't make the game this time and suggested trying something simpler.

In production a Creator asked, in Chinese, for a sailing and trading game in the style of the classic age-of-exploration games. The agent read make-game and three of its guides, wrote the design, the art and the game, got a green playtest, rendered the music, fixed one failing test until all three passed, and called `build`. The harness refused that `build`: the run was past its 300 s. The Creator got an apology and was asked to say it more simply. The run took about 6 minutes and $0.46 over 13 model calls, under the step limit. The time went to the box's fixed costs, not to a loop: about 7 s per typecheck, 10 to 17 s per test, about 33 s per playtest, and the music.

A wall clock threw away a finished game. Time measures how busy the box was, not how much the run cost or whether it was stuck. Money and steps measure those.

## Decision

- **No time limit per message.** The 300 s deadline goes, and with it the refusal that named it.
- **Each command has its own time limit.** Every command in the box runs under `timeout`, 180 s (`COMMAND_TIMEOUT_S`, up from 120 s): a playtest, each command of `build`'s check, the music render, and the agent's bash. bash may ask for less, never more, so its error reads "Command timed out after 180 seconds". A command past its limit is ended with everything it started. Its tool returns an error that says it timed out, and the run goes on. 180 s is about 5 times the slowest call measured in production (a 33 s playtest) and well above 4 tests at 17 s each, the most make-game allows.
- **The step limit is 30, up from 20.** The deadline was what stopped the incident's run, at 13 steps. Without it, a big game's reads and writes reach 20 steps before the work is done. A step late in a run reads about 56K cached tokens, about $0.015 (measured in the incident's snapshot), so 10 more steps cost tens of cents in the worst case. The 4 `build` calls and ADR 0004's weekly Allowance stay as they are.
- **A 20-minute ceiling, against a broken loop.** It is a safety net, not a budget, and no normal run comes near it. Past it, tools are refused, as past the step limit.
- **A finished game is still published past a limit.** Past the ceiling or the step limit, a run that has published nothing may call `build` once more. The refusal tells the agent to call it if the game is finished and its last playtest passed, and to reply otherwise. If that `build` passes, the Creator gets the game. If it fails, the next call is refused for good. A run that already published gets the Revision it published, as ADR 0008's port does. The build limit allows no extra `build`.
- **An abort timer at 25 minutes.** `MAKER_BUILD_ABORT_S` moves from 330 s to 1500 s, 5 minutes past the ceiling, so the last `build` has time to finish. It ends only a model call that never returns, which no tool call's limit sees.
- **The harness tells the agent facts and what to do, never what to say.** No harness text is a sentence for the Creator, or a line to say word for word. That covers the refusals, the busy line and the used-up line. The agent writes its reply in the Creator's language. It says what it made, what isn't in it yet, and that sending the request again carries on or starts afresh. It never names a limit, apologises for one, or asks the Creator to simplify or reword their request.
- **The eval has a big request.** The `big-voyage` chat asks for a whole sailing and trading game in one English message. It passes when a Revision is published and no reply names a limit or asks for something simpler. Every chat now fails on such a reply.

## Consequences

- A big game can take 10 minutes or more to arrive, and until P6b's progress states the app shows the Creator nothing new while it waits.
- One message can cost more than before: up to 30 steps and 4 `build` calls instead of being cut off at 5 minutes. The Allowance still bounds a Creator's week, and a run's overshoot stays at one run (ADR 0004).
- A hung command costs at most 180 s of the run, not the run.
- The step and build limits stay in the agent's prompt. The ceiling isn't, since the agent shouldn't plan around it.
