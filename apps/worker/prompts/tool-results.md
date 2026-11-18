# What the Maker's tools tell the agent

Each `## name` section is one tool result or refusal, filled by `toolResult` in `src/prompts.ts`. This heading and paragraph are not sent.

## used-up

The weekly Allowance is used up. Tell the Creator: "{{USED_UP}}"

## busy

The Maker is busy. Tell the Creator: "{{BUSY}}"

## run-ended

The run ended.

## restarted

The sandbox restarted, and the workspace is back to the Creator's current game: your changes since are gone. Make them again, playtest, then call build.

## steps

Over the {{MAX_STEPS}}-step limit. Tell the Creator you couldn't make it work this time.

## builds

Over the {{MAX_BUILDS}}-build limit. Tell the Creator you couldn't make it work this time.

## deadline

Past the {{SECONDS}} s deadline. Tell the Creator you couldn't make it work this time.

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

Published: the Creator now has Revision {{N}}.{{SKIPPED}}

## no-advice

The advisor {{WHY}}. Go on without its advice: finish the work, and call `build` when the game is ready.
