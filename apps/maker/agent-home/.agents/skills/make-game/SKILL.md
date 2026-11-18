---
name: make-game
description: How to make or change the Creator's game, from the design to `build`, and what a finished hopon game is. Load it when the Creator asks for a new game or a change to their game, before any other skill or tool. Never load it for chat or a question.
---

# Making a hopon game

You design the game, write it, test it, and publish it with `build`. The Creator sees only your final reply and the game.

## The workspace

The workspace holds one game: the files of the game the Creator has now, or nothing before the first one. A game is played on a phone, in portrait, by touch.

- **A new game, a different game, or "Start over":** first empty the workspace (delete `design.md`, `game.ts`, `index.html`, `music.mjs`, `music.py` and `tests.json`), then call `build` with kind `"new"`.
- **A change:** edit the existing files and call `build` with kind `"change"`.
- **Until a `build` succeeds, the Creator has no game.** Treat every request until then as a complete new game that includes everything the Creator has asked for so far.

The engine:

- **Plain DOM** (load the `dom-games` skill) for cards, quizzes, word games, trivia, and puzzles of tiles or buttons.
- **LittleJS** (load the `littlejs-api` skill) for everything that moves: action, arcade, physics, runners, shooters.
- **When the workspace already has a game, keep its engine.** `index.html` means plain DOM, and `game.ts` alone means LittleJS. Load the matching skill and read the game's files before you change anything.

Skills are not in the workspace, so bash can't see them. Load them with `activate_skill`. Don't explore the workspace either: it holds only the game's files.

## Workflow

1. **Design.** Write `design.md` (see Design).
2. **Tests.** Write `tests.json` from the design's Done-when criteria (see Tests).
3. **Code.** Load the engine's skill, then write the whole game with the write tool: `game.ts`, plus `index.html` for plain DOM. For a change, edit the existing files, and don't rewrite what works.
4. **Playtest.** Call `playtest` with `inputs` that play the game the way a player would: taps where the buttons, cards or targets are, swipes for swipe controls, timed so the game gets going. It typechecks first, and type errors come back with no screenshots.
5. **Fix.** Look at both screenshots. Fix every error and anything that looks wrong or unreadable, then playtest again. Screenshots show how the game looks. Your tests and the playtest's `state`, `score` and `overAt` show what the game does (it ends, the score goes up, a swipe moves the player), so don't replay a game only to see that in a screenshot.
6. **Music.** Once the playtest is green, write the music (see Music).
7. **Verify.** In the workspace, run `node /opt/hopon/verify.js new` for a new game, or `node /opt/hopon/verify.js change` for a change (`node /opt/hopon/verify.js change --had-music` when the game had a `music.mjs` or `music.py`). It checks that `design.md`, `tests.json`, the game and, for a new game or a game that had music, the music are all there. Fix everything it lists.
8. **Build.** When verify passes and the game does what the Creator asked, call `build` with the game's title, a one-line description for the feed (what the game is and how to play it), kind, and whether it has music. `build` runs verify again, typechecks the game, renders the music, plays the game for a second and runs `tests.json`. If it fails, fix what it lists, playtest, and call `build` again.
9. **Reply.** When `build` succeeds, stop working and write your one reply to the Creator. Don't add features, files or refactors that weren't asked for.

## Design

Before you write any code, write `design.md`: the complete game design, in English, with no code. It is what you build and check against. There is no word limit: make it clear, complete and specific, with numbers, so that two people building from it would make the same game. Write these parts, each as a heading or a line that starts with its name:

- **Goal:** what the player does, and how the game is won or lost.
- **Rules:** what moves, spawns, scores and hurts, with numbers: speeds, sizes, counts, timers, lives, points.
- **Controls:** the taps and swipes on a portrait phone screen, and where on the screen they go.
- **Difficulty:** how it starts, and how and when it ramps up.
- **Fairness:** the first threat comes after about 2 seconds. Every danger can be seen and avoided. Hit areas for dangers are a bit smaller than they look, and for targets a bit bigger. Targets are finger-sized.
- **Look:** the setting, characters, palette and mood, and what happens on a hit, a point and the end.
- **Language:** the language of the on-screen text. When the Creator writes in another language, the on-screen text is in that language.
- **Music:** the genre, mood and tempo that fit the game. Write `Music: none` only when the Creator asked for no music or for silence, and quote their words: `Music: none ("no music please")`. For a new game, or a change that drops a game's music, verify checks that the quote is one of the Creator's messages since their last new game, or at least three words of one, word for word.
- **Done when:** 2 to 5 success criteria, one per line, each something a short playtest can show ("Tapping the left half moves the basket left.", "The game ends after 3 misses.").

For a change, update `design.md` first: say exactly what changes, with numbers where it matters, then write "Keep everything else.", and give Done-when criteria for the change. Change exactly that, and keep everything else. An older game may have no `design.md`: write it from the game's code first, with its music as the game has it (`Music: none` with no quote when it has none).

## Tests

Before you write code for a new game or a change, write `tests.json`: automated checks of what the Creator asked for (for a change, only the change), as `{"expose": [...], "tests": [...]}`. `build` runs them and refuses the game until every one passes. Run them yourself with `node /opt/hopon/playtest.js tests`.

How a test runs: the harness loads the built game in a 360 × 640 CSS px portrait browser, taps (180, 320) to start, waits 500 ms, then sends the test's inputs at their `at` times (ms after that wait) and evaluates each check at its `at` time. The game runs in real time between inputs.

- **expose:** the game values your tests read, each with its meaning and unit, for example `{"name": "penguinHeight", "means": "how high the penguin is above the ground, in px; 0 on the ground"}`. Keep each one up to date every frame, from the game's real state, on a top-level object in `game.ts`: `const testVars: Record<string, number | string | boolean> = {};`. Keep it when you change the game. Prefer what the player sees happen (positions, counts, lives) over settings (speeds, intervals), which a game can report without using. `score` (a number) and `state` (`"start"`, `"play"` or `"over"`) always exist and need no entry.
- **tests:** 1 to 4, each `{"name", "inputs": [{"at", "type": "tap" | "swipe", "x", "y", "dx"?, "dy"?}], "checks": [{"at", "expect": a JavaScript boolean expression}]}`. An expression can read `vars`, `score`, `state`, and `prev`: the same three at the check before (at the start for the first), as `prev.vars`, `prev.score` and `prev.state`. For example `vars.timeLeft < prev.vars.timeLeft`.
- **Inputs follow the Controls.** Put taps where the controls are. A tap is a quick press and release.
- **Bounds are loose.** Check direction and order ("goes up then comes back down", "more than before"), not exact numbers.
- **A test passes for any game that does what the Creator asked,** and fails for one that skips what it tests.
- **What can't be checked from values gets no test,** such as a color, a costume, a mood or a sound. When nothing in the request can be tested, write `{"expose": [], "tests": []}`.

## The playtest

A playtest runs on a fake clock, so a minute of play takes seconds, and input times are in game ms. When the game ends, the playtest stops: `overAt` is when, no later input is played (a tap would start a new round), and the end screenshot is the over screen a second later.

A playtest is red when the typecheck fails, there is any console error, the clock didn't run, or the start and end screenshots are identical (a frozen or blank game). `state "over"` within 3 s of the start is a warning: the game ends before a player can act, so make it more forgiving.

## Playable and correct

Build a playable, correct game, not a static screenshot. The engine's skill says how. This section says what done looks like.

- **It starts and moves.** The tap that starts the game starts it, and within a second something happens on screen.
- **The controls work on the first touch,** where the design puts them, and do what it says. A tap target is at least 48 CSS px across.
- **It ends.** The player can lose, and win when the game has a win. The game then calls `hopon.gameOver()`, and a tap starts a fresh round with everything reset.
- **The rules are the ones on screen.** What hits, scores and hurts matches what the player sees. Nothing that matters is off screen or too small to see.
- **No dead ends.** No state where nothing can happen and the game hasn't ended: a level with no way forward, a timer that never runs out, a board with no move left.
- **Every Done-when criterion is met,** shown by the tests, the playtest's `state`, `score` and `overAt`, or its screenshots.
- **It is fair.** The engine skill's "Fair games" and "Hits and collisions" sections are the most common reasons a green game still isn't playable.

## Made for a phone

- Portrait, at least 360 × 640 CSS px and often taller. Use the whole height, keep everything inside the screen, and keep clear of the score in the top-left corner.
- Touch only: taps, holds and swipes with one finger. No hover, no keyboard, no right-click, no pinch.
- Text at least 18 CSS px, with strong contrast against what's behind it.

## Performance

Aim for a steady 60 frames a second on a mid-range phone. A frame has about 16 ms for the game, the drawing and the browser together.

- **Minimize draw calls.** LittleJS batches shapes and sprites on WebGL until a draw switches texture, which flushes the batch. Draw the things that share a sprite one after another, and keep the number of sprite textures small.
- **Text isn't batched.** `drawText` and `drawTextScreen` draw with Canvas 2D. Keep text to the HUD and a few labels, never a label on every object every frame.
- **Make things once.** Make sprites, textures, sounds and gradients at top level or in `gameInit`, never in `gameUpdate` or `gameRender`.
- **Keep counts bounded.** Destroy what leaves the screen, cap how many things can spawn, and keep particle emitters short (`emitTime` well under a second, a modest `emitRate`).
- **No everything-against-everything.** With many objects, check hits against the player or what's near, not every pair every frame.
- **Backgrounds are a few big shapes,** not hundreds of small ones redrawn each frame.
- **Plain DOM:** animate `transform` and `opacity`, not `top`, `left`, `width` or `height`. Change only the elements that changed, and never rebuild the page with `innerHTML` every frame. Don't read layout (`getBoundingClientRect`, `offsetWidth`) inside a loop. Don't animate `box-shadow` or `filter`.

## Music

Every new game has music unless the Creator asked for none. Pick a genre, mood and tempo that fit the game. For a change, touch the music only when the Creator asks for music or a change to it: a game without music stays without it, and a game with music keeps it unless the Creator asks to drop it (`Music: none` with their words).

When the Creator asks for silence ("silent", "no sound", "mute", "quiet"), the game has no music and no sound effects either: no `Sound` and no ZzFX. When they only say no music, sound effects are fine.

Write it once the game is green. Load the `music-synth` skill for chiptune, electronic or arcade styles (`music.mjs`), or the `music-sf2` skill for acoustic, orchestral, folk, period or world styles played on real instruments (`music.py`). A game has one music file, so when you switch, delete the other. `build` renders it whenever there is one.
