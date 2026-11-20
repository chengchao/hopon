# What the Maker's tools tell the agent

Each `## name` section is one tool result or refusal, filled by `toolResult` in `src/prompts.ts`. This heading and paragraph are not sent.

## used-up

The Creator's weekly Allowance of hopon tokens is used up: nothing can be made or changed until their week resets, and the app shows them when that is. Call no more tools. Tell the Creator so in a sentence.

## busy

The Maker is busy: its sandbox couldn't start. Call no more tools. Tell the Creator in a sentence that you couldn't start on it just now, and that sending the message again in a minute should work.

## run-ended

The run ended.

## restarted

The sandbox restarted, and the workspace is back to the Creator's current game: your changes since are gone. Make them again, playtest, then call build.

## steps

Over this message's {{MAX_STEPS}}-step limit. {{NEXT}}

## builds

Over this message's {{MAX_BUILDS}}-build limit. {{NEXT}}

## ceiling

Past this message's {{MINUTES}}-minute ceiling. {{NEXT}}

## last-build

One last `build` can run now, and no other tool. If the game in the workspace is finished and its last playtest passed, call `build` with it now: the Creator gets it, and you reply as `build` says. If it isn't finished, call no tool, and reply as below.

{{GIVE_UP}}

## give-up

Nothing from this message is published, so the Creator's game is as it was before it, or there is still no game if there was none. Call no more tools. Reply with what you were making for them, that it isn't ready yet, and that sending the request again starts it afresh. If they have a game, say it's still there as it was.

## kept

Revision {{N}}, which you published in this run, stays: the Creator has it. Call no more tools. Reply with what the game is and how to play it, then in a few words what of their request it doesn't have yet, and that sending that part again adds it.

## no-game

There's no game yet, so there is nothing to change: build it with kind "new".

## not-ready

Not ready to publish:

{{FAILURES}}

## check-failed

The harness check failed:

{{ERRORS}}{{SKIPPED}}

Fix these, playtest, then call build again.

## skipped

These checks threw and were skipped; fix them in tests.json: {{ERRORS}}

## published

Published: the Creator now has Revision {{N}}.{{SKIPPED}} If you're done, reply to the Creator with what the game is and how to play it. Say nothing about how you made it: not the advisor, tests, playtests or checks, and nothing you skipped.

## no-advice

The advisor {{WHY}}. Go on without its advice: finish the work, and call `build` when the game is ready.
