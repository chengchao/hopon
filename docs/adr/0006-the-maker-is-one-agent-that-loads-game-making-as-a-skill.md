# 6. The Maker is one agent that loads game making as a skill

## Status

Proposed. Supersedes ADR 0005 and the Talker and Coder split of ADR 0003. ADR 0003's box, its Durable Object per Draft and its Container, and ADR 0004's Allowance stay as they are.

## Context

ADR 0005 runs two agents in one `Maker`. An Opus main agent chats with the Creator and briefs a Sonnet sub agent through a `build` tool, and the sub agent writes the game. The single-agent prototype (branch `claude/maker-single-agent`, commits `184d870` to `aedda08`) ran the same eight-chat e2e eval on its Preview with one Sonnet agent that chats and writes the game itself. A sweep cost about $1.2 to $1.3 against $2.34 for two agents. The median build took 54 to 83 seconds against about 105. The judge's "looks" score was 3.1 to 3.3 against 3.7, and every build was green.

Creators also send messages that are not about a game: a greeting, a thank-you, a question about hopon. An agent that always carries the whole game workflow in its prompt pays for it on each of those turns.

## Decision

- **One agent.** The Maker's root conversation is the only conversation. It runs on `MAKER_MODEL` at `MAKER_EFFORT`, Sonnet 5.5 at medium by default. `MAKER_MAIN_*` and `MAKER_SUB_*` go. Its tools are pi's coding tools, the skills through `activate_skill`, `playtest`, and `build`.
- **Game making is a skill.** The system prompt, `apps/worker/prompts/maker.md`, holds the Maker's voice, when to make a game, what games can't do, and the limits. The workflow, the design rules and the tests rules are the `make-game` skill. The prompt tells the agent to load it only when the Creator asks for a game or a change. The engine and music skills stay as they are. `building-games` and `AGENTS.md` fold into `make-game`.
- **Prompts are Markdown.** The Worker bundles `prompts/*.md` as text. Values the code owns (the limits, the busy and used-up lines, the title and description lengths) are `{{name}}` placeholders that `renderPrompt` in `apps/worker/src/prompts.ts` fills at load. A placeholder with no value, or a value with no placeholder, throws.
- **The design has no word limit.** The main agent's brief was capped at 300 words. The agent now writes `design.md` itself, and the skill asks for a clear, complete and specific design with numbers: Goal, Rules, Controls, Difficulty, Fairness, Look, Language, Music and Done when.
- **`build` publishes the workspace.** It runs `/opt/hopon/verify.js` (design, Done-when criteria, tests, game and music all present), then the harness check of ADR 0005 with the agent's own `tests.json`, then writes Revision n+1 and the Draft's title and description. A failure is the tool's error result. The tool keeps the name `build`, because the app's chat draws the game card from a `build` result and the status line from a running `build`, so the app needs no update.
- **`Music: none` needs the Creator's words.** The Maker keeps every message the Creator sends and writes them to `.hopon/asked.txt` in the workspace before each run and before each `build`. verify.js accepts `Music: none` only with a quote that one of those messages contains. The check's sweep removes `.hopon/`, so it never reaches a Revision.
- **Only the reply reaches the Creator.** The Worker's socket strips the text of any assistant message that also calls a tool, and streams no text, since text can't be told from a note until its message ends. The model's transcript keeps everything. A prompt rule against notes between tool calls did not stop them in the prototype's eval.
- **Limits per message.** 20 tool calls not counting `build`, 4 `build` calls, and 5 minutes, enforced by a `beforeTool` hook. Past one, tools are refused and the agent tells the Creator. The run's first tool call checks the Allowance and brings up and restores the box. Each later call brings the box up again, so a box that stopped mid-run is restarted and the agent told before the call runs.

## Consequences

- One model call per step instead of a main agent's turn around each build, so a sweep costs less and a build ends sooner. The prototype measured both. The judge's "looks" score fell by about 0.4 in the prototype.
- A chat turn that isn't about a game loads no skill and calls no tool.
- `design.md` and `tests.json` stay in the box between turns but are not part of a Revision. A change after the box idled out starts with no `design.md`, and the skill tells the agent to write it from the game's code first.
- The app shows no status line until the agent calls `build`, because only `build` drives it.
- The talker eval and `apps/maker/src/talker.ts` go. The e2e eval reads the one agent's builds from its tool calls, and the judge grades them against the Creator's messages.
