---
name: make-game
description: How to make or change the Creator's game, from the design to `build`, and what a finished hopon game is. Load it when the Creator asks for a new game or a change to their game, before any other tool. Its references hold the engine, sound and music guides. Never load it for chat or a question.
---

# Making a hopon game

You design the game, write it, test it, and publish it with `build`. The Creator sees only your final reply and the game.

**References (load on demand).** This file is all the design and the tests need. Open a reference with `read_skill_resource` (name `make-game` and its path) at the Workflow step that names it, one at a time, and never ahead of that step: a guide read early crowds out the design.

- `references/phaser.md`, `references/r3f.md`, `references/react.md`: one engine's files, API, traps and looks. Open the one engine's guide at step 4 (Code), once `design.md` and `tests.json` are written. Never open a second engine's.
- `references/phaser-panels.md`: React panels of words and buttons over a Phaser scene, such as a shop or an inventory. Open it after `references/phaser.md`, at step 4, only for a game with such panels. `references/phaser-panels-example.md` is a whole game built that way: open it only when the guide leaves a question.
- `references/sound-effects.md`: the scaffold's sounds and how to write the game's own. Open it at step 4 (Code), when you write the code that plays them.
- `references/music-synth.md`: chiptune, electronic and arcade music, as `music.mjs`. `references/music-sf2.md`: acoustic, orchestral, folk and world music on sampled instruments, as `music.py`. Open the one that fits at step 7 (Music), once the playtest is green.

## The workspace

The workspace holds one game: the files of the game the Creator has now, or nothing before the first one. A game is played on a phone, in portrait, by touch.

- **A new game, a different game, or "Start over":** first empty the workspace and seed the new game's skeleton with this command, then call `build` with kind `"new"`. It deletes every file and folder of the old game, its modules, images and notes too, and keeps only `.hopon/`, where verify.js reads what the Creator said. Anything left behind would ship in the new game's source.

  ```bash
  find /workspace -mindepth 1 -maxdepth 1 ! -name .hopon -exec rm -rf {} + && node /opt/hopon/starter.js
  ```

- **A change:** edit the existing files and call `build` with kind `"change"`.
- **Until a `build` succeeds, the Creator has no game.** Treat every request until then as a complete new game that includes everything the Creator has asked for so far.

A game is a Vite project: `index.html`, `vite.config.ts`, one `tsconfig.json`, and its code in `src/`, entered at `src/main.tsx`. `node /opt/hopon/starter.js` writes the first three, the same for every engine and every game, and a `src/main.tsx` stub. Keep the three as they are: the game's title and hint are `hopon.title` and `hopon.hint`, set at the top of `src/main.tsx`, and its look lives in its code. Write `src/main.tsx` over the stub. Sound effects are the scaffold's too (`hopon.play`), so a game writes only its own sounds. Each engine has a guide in this skill's `references/`, which gives every file, the engine's API and its traps, and how to make the game look good. Pick the engine by what the game is:

- **Phaser** (`references/phaser.md`) for 2D games with motion or a world to move around in: action, arcade, physics, runners, shooters, catchers, flappers, and games on a map, such as role-playing, adventure, strategy, trading and farming games.
- **Phaser with React panels** (`references/phaser.md`, then `references/phaser-panels.md`) when a Phaser game also has panels of words and buttons, such as a shop, an inventory, upgrades or a dialogue. The world is the Phaser scene and the panels are React over it. End its new-game command with `node /opt/hopon/starter.js panels`, which also writes the bridge between them. Never make such a game in React alone, with the world left out. A game with only a score, lives or a timer is plain Phaser.
- **React Three Fiber** (`references/r3f.md`) for 3D games: racers, flyers, 3D runners and dodgers, and anything the Creator calls 3D.
- **React** (`references/react.md`) for cards, quizzes, word games, trivia, and puzzles of tiles or buttons.
- **A vague request:** pick a game with motion, in Phaser, or in r3f when 3D fits it better.
- **When the workspace already has a Vite game, keep its engine.** `src/` importing `phaser` means Phaser (with React panels when it has a `src/panels.tsx`), `@react-three/fiber` means r3f, and React alone means React. Read the game's files before you change anything.

The guides and the skills are not in the workspace, so bash can't see them. Don't explore the workspace either: it holds only the game's files. Each guide's example is a whole game: build your own game from its patterns, with its own design, names, look and rules, never a copy of the example.

## An old game

A Draft from before Vite games has a `game.ts` and no `vite.config.ts`. hopon no longer builds such a game: verify and `build` refuse it until it is ported. `game.ts` alone is a LittleJS game, and `game.ts` with an `index.html` is a plain-DOM game. Any change to one starts by porting it, in the same run, before the change:

1. Read `game.ts` (and `index.html`). When the game has no `design.md`, write one from its code first (see Design), with its music as the game has it: `Music: none` with no quote when it has none. When it has no `tests.json`, write one for what it does now.
2. Port it to the matching engine: LittleJS to Phaser, plain DOM to React. Read that engine's guide. Keep the design: the same rules, numbers, controls, layout and look, so the same taps land on the same things. Keep every name the tests read, now in `hopon.testVars`. It may look better than it did.
3. Delete `game.ts` and the old `index.html`, run `node /opt/hopon/starter.js` for the skeleton, and write the game's own files. Keep `design.md`, `tests.json` and the music file (`music.mjs` or `music.py`) as they are.
4. Playtest the port, and run the old tests with `node /opt/hopon/playtest.js tests`. They pass on the port before you make the change.
5. Publish the port on its own: call `build` with kind `"change"`, with no advisor check. A port and a change together may not fit in one message's limits, and work you haven't published is lost when a limit stops you. Once the port is published, the Creator's next message starts from it.
6. Then make the Creator's change as usual (update `design.md`, the tests, the code), and call `build` with kind `"change"` again. Don't mention the port to the Creator unless they ask. When a limit stops you after the port's `build`, its refusal says what to tell the Creator.

## Workflow

1. **Design.** Write `design.md` (see Design). It needs no reference.
2. **Design check.** When `design.md` has Pillars, call `ask_advisor` with "Design check." now, before the tests and the code, and change `design.md` as it says. A design without Pillars skips this step.
3. **Tests.** Write `tests.json` from the design's Done-when criteria (see Tests).
4. **Code.** Open the engine's guide and `references/sound-effects.md`, then write the whole game with the write tool: every file the guide names but the skeleton the starter wrote. Split the code into modules when it grows past a few hundred lines. For a change, change the existing files with the `edit` tool, and don't rewrite what works.
5. **Playtest.** Call `playtest` with `inputs` that play the game the way a player would: taps where the buttons, cards or targets are, swipes for swipe controls, timed so the game gets going. It typechecks first, and type errors come back with no screenshots.
6. **Fix.** Look at both screenshots. Fix every error and anything that looks wrong or unreadable, then playtest again. Fix with the `edit` tool, changing only the lines that need it: a file written again in full costs the Creator as much as writing it the first time. Screenshots show how the game looks. Your tests and the playtest's `state`, `score` and `overAt` show what the game does (it ends, the score goes up, a swipe moves the player), so don't replay a game only to see that in a screenshot.
7. **Music.** Once the playtest is green, open the music guide and write the music (see Music).
8. **Verify.** In the workspace, run `node /opt/hopon/verify.js new` for a new game, or `node /opt/hopon/verify.js change` for a change (`node /opt/hopon/verify.js change --had-music` when the game had a `music.mjs` or `music.py`). It checks that `design.md`, `tests.json`, the game and, for a new game or a game that had music, the music are all there. Fix everything it lists.
9. **Check with the advisor.** When verify passes, run your tests with `node /opt/hopon/playtest.js tests` until they pass, then ask the advisor for the done check (see Asking the advisor). Fix what it finds that the Creator asked for or that is broken, then playtest and run the tests again.
10. **Build.** When the done check is answered and the game does what the Creator asked, call `build` with the game's title, a one-line description for the feed (what the game is and how to play it), kind, and whether it has music. `build` runs verify again, typechecks the game, renders the music, plays the game for a second and runs `tests.json`. If it fails, fix what it lists, playtest, and call `build` again.
11. **Reply.** When `build` succeeds, stop working and write your one reply to the Creator, under 40 words: the game's name and how to play it, not every rule. Say nothing about how you made it: no advisor, tests, playtests, verify or `build`, and nothing you skipped or didn't check. Don't add features, files or refactors that weren't asked for.

## Asking the advisor

`ask_advisor`'s description names the moments to ask. It costs the Creator more than your own steps, so ask at those moments only. What the description leaves out:

- **The design check goes before the tests and the code.** A pillar that was dropped or made into a menu costs one line to put back in `design.md`, and most of the game once it is written. Ask with the design written and nothing else: "Design check."
- **The done check goes before `build`, not after.** A `build` that succeeds publishes the game, so advice taken after it would cost a second `build`. When the check finds nothing, call `build`. When `build` then fails, fix what it lists and build again without a second done check.
- **A hard design choice** is one where you can't tell which way is right, such as whether to keep the level data apart from the physics. **A large structural change** is a request such as multiplayer, saves or levels: ask how to restructure first, or whether it fits a hopon game at all.
- **A small, clear change** needs no advice before you make it, only the done check.
- **Follow the advice,** then go on. When it says the plan or the game is fine, go on with it. When the tool says you get no advice, go on without it and call `build` when the game is ready.

## Design

Before you write any code, write `design.md`: the complete design of the game as it will be after this message, in English, with no code. You write the tests and the code from it, the advisor checks the game against it, and the next change starts from it, so a decision that isn't in it gets made by accident in the code. There is no word limit, and a big game needs a long design. Make every part specific enough that two people building from it would make the same game: "fish get faster over time" leaves the builder guessing, and "fish swim at 60 px a second, plus 5 for each fish caught, up to 160" does not. Positions and sizes are in CSS px on a 360 × 640 portrait screen, from its top-left, the same px the tests tap. A 3D game gives its world in its own units and its controls in screen px.

Write these parts, each as a heading or a line that starts with its name:

- **Asked:** everything the Creator has asked for since their last new game, one line for each thing, in their own words inside quotation marks. Every line here is in the finished game.
- **Pillars:** only when the Creator names a game or a kind of game ("like Zelda", "a roguelike", "a farming game"), or asks for a big game. What a player who knows that game would expect to find in this one, in 4 to 7 lines:
  - the view, such as a top-down map of square tiles, a side view, or a board;
  - what the player does from moment to moment, such as steering a ship from tile to tile, or planting and watering crops;
  - the places the game moves between, such as the open sea, a harbour town, a shop and a battle;
  - the loop that joins them, such as buy cheap, travel, sell dear, upgrade;
  - what grows over a play, such as gold, a crew, a level or a farm;
  - how it looks, such as 16-bit pixel art.

  The game keeps every pillar as something the player does and sees on screen. To make the game fit, make a pillar smaller: 5 towns where the named game has 50, one kind of enemy where it has twenty. Never drop a pillar, and never turn one into a menu or a line of text. A sailing game where nobody steers a ship, or a role-playing game that is only its shop, is not the game the Creator asked for. Take how the named game plays, and give this one its own name, characters, places and art. When a pillar is something a hopon game can't do, such as saving, write which pillar, and what stands in for it.

- **Goal:** what the player does, and how the game is won or lost. Nothing is saved between plays, so a long game gets a goal that one sitting of about 5 minutes can reach: count the moves, trips or days it takes from the game's own numbers, and shrink the game until they fit.
- **Screens:** every screen the player sees during play: what is on it and where, in px, and what takes the player to the next one. A place in Pillars is a screen of its own, drawn as that place. Its words and buttons may sit in a panel over the drawing, never in place of it. A game with one screen gives its layout here.
- **Rules:** what moves, spawns, scores and hurts, with numbers: speeds, sizes, counts, timers, lives, points, prices. A game on a grid gives the grid: its columns, rows and tile size, what each kind of tile is, and how the player moves on it. A map is written out whole, as rows of characters with a legend, and is no bigger than the game needs: nothing on it is left for the code to invent. A game with levels, goods, enemies or items lists them, each with its numbers.
- **Controls:** the taps and swipes on a portrait phone screen, where on the screen they go, and what each does on each screen.
- **Difficulty:** how it starts, and how and when it ramps up.
- **Fairness:** how this game meets each of these, with its own numbers, each worked out from the Rules and not estimated: a distance over a speed, a price against the starting gold. The first threat comes after about 2 seconds. Every danger can be seen and avoided. Hit areas for dangers are a bit smaller than they look, and for targets a bit bigger. Targets are finger-sized.
- **Look:** the art style in a few words, the setting, the mood, and a palette of 4 to 6 colours. Then how each screen and each main thing on it is drawn: its shape, its colours and the detail that makes it read as what it is. A bare box, a bare circle or a line of text is not a drawing of a ship, a town or a shopkeeper. Then what happens on a hit, a point and the end.
- **Language:** the language of the on-screen text. When the Creator writes in another language, the on-screen text is in that language, the scaffold's screens too: set `hopon.title`, `hopon.hint` and every word of `hopon.text` (`win`, `over`, `score`, `best`, `again`) at the top of `src/main.tsx`, for example `hopon.text = { again: "Toca para jugar otra vez", best: "Récord", over: "Fin del juego", score: "Puntos", win: "¡Ganaste!" };`.
- **Music:** the genre, mood and tempo that fit the game. Write `Music: none` only when the Creator asked for no music or for silence, and quote their words: `Music: none ("no music please")`. For a new game, or a change that drops a game's music, verify checks that the quote is one of the Creator's messages since their last new game, or at least three words of one, word for word.
- **Done when:** 2 to 5 success criteria, one per line, each something a short playtest can show ("Tapping the left half moves the basket left.", "The game ends after 3 misses."). When the design has Pillars, the criteria show the pillars first ("Swiping up moves the ship one tile north.", "Tapping a harbour tile opens its town screen.").

For a change, edit `design.md` first, so that it still describes the whole game. Add the Creator's new words to Asked, change the lines the change touches with the `edit` tool, with numbers where it matters, and leave every other line as it is. Never add the change at the end as a note: verify reads the first Music and Done when it finds. Replace Done when with criteria for this change. Then change exactly that in the game, and keep everything else. An older game may have no `design.md`: write it from the game's code first, with its music as the game has it (`Music: none` with no quote when it has none).

## Tests

Before you write code for a new game or a change, write `tests.json`: automated checks of what the Creator asked for (for a change, only the change), as `{"expose": [...], "tests": [...]}`. `build` runs them and refuses the game until every one passes. Run them yourself with `node /opt/hopon/playtest.js tests`.

How a test runs: the harness loads the built game in a 360 × 640 CSS px portrait browser, taps (180, 320) to start, waits 500 ms, then sends the test's inputs at their `at` times (ms after that wait) and evaluates each check at its `at` time. The game runs in real time between inputs.

- **expose:** the game values your tests read, each with its meaning and unit, for example `{"name": "penguinHeight", "means": "how high the penguin is above the ground, in px; 0 on the ground"}`. Keep each one up to date every frame, from the game's real state, in `hopon.testVars` (`hopon.testVars.penguinHeight = height;`). Keep them when you change the game. Prefer what the player sees happen (positions, counts, lives) over settings (speeds, intervals), which a game can report without using. `score` (a number) and `state` (`"start"`, `"play"` or `"over"`) always exist and need no entry.
- **tests:** 1 to 4, each `{"name", "inputs": [{"at", "type": "tap" | "swipe" | "pause" | "resume", "x"?, "y"?, "dx"?, "dy"?}], "checks": [{"at", "expect": a JavaScript boolean expression}]}`. An expression can read `vars`, `score`, `state`, and `prev`: the same three at the check before (at the start for the first), as `prev.vars`, `prev.score` and `prev.state`. For example `vars.timeLeft < prev.vars.timeLeft`.
- **Inputs follow the Controls.** Put taps where the controls are, in CSS px from the top-left of the 360 × 640 screen. A tap is a quick press and release. `pause` and `resume` are the feed scrolling the game away and back; a game with a clock or motion gets one test that its clock stops while paused (the engine's guide shows it).
- **Bounds are loose.** Check direction and order ("goes up then comes back down", "more than before"), not exact numbers.
- **A test passes for any game that does what the Creator asked,** and fails for one that skips what it tests.
- **What can't be checked from values gets no test,** such as a color, a costume, a mood or a sound. When nothing in the request can be tested, write `{"expose": [], "tests": []}`.

## The playtest

A playtest runs on a fake clock, so a minute of play takes seconds, and input times are in game ms. When the game ends, the playtest stops: `overAt` is when, no later input is played (a tap would start a new round), and the end screenshot is the over screen a second later.

A playtest is red when the typecheck or the build fails, the game didn't call `hopon.ready()` within 10 s, there is any console error, the clock didn't run, or the start and end screenshots are identical (a frozen or blank game). The page is served under a path, as on the phone: a file named by an absolute path such as `/ship.png` isn't found, so import every asset from `src/`. `state "over"` within 3 s of the start is a warning: the game ends before a player can act, so make it more forgiving.

## Playable and correct

Build a playable, correct game, not a static screenshot. The engine's guide says how. This section says what done looks like.

- **It starts and moves.** The scaffold's start screen takes the first tap and sets `hopon.state` to `"play"`. Within a second something happens on screen. Nothing advances before that.
- **The controls work on the first touch,** where the design puts them, and do what it says. A tap target is at least 48 CSS px across.
- **It ends.** The player can lose, and win when the game has a win. The game then calls `hopon.gameOver()`, and the scaffold's tap starts a fresh round, in which the game resets everything.
- **It stops when the feed pauses it** (`hopon.paused`), and goes silent when the feed mutes it.
- **The rules are the ones on screen.** What hits, scores and hurts matches what the player sees. Nothing that matters is off screen or too small to see.
- **No dead ends.** No state where nothing can happen and the game hasn't ended: a level with no way forward, a timer that never runs out, a board with no move left.
- **Every Done-when criterion is met,** shown by the tests, the playtest's `state`, `score` and `overAt`, or its screenshots.
- **It is fair.** The engine guide's "Fair games" and "Hits and collisions" sections are the most common reasons a green game still isn't playable.

## Made for a phone

- Portrait, at least 360 × 640 CSS px and often taller. Use the whole height, and keep everything inside the screen. The scaffold shows the start and over screens; during play the game draws its own score.
- Touch only: taps, holds and swipes with one finger. No hover, no keyboard, no right-click, no pinch.
- Text at least 18 CSS px, with strong contrast against what's behind it.

## Performance

Aim for a steady 60 frames a second on a mid-range phone. A frame has about 16 ms for the game, the drawing and the browser together.

- **Make things once.** Make textures, geometries, materials and sounds once, never in the per-frame update.
- **Keep counts bounded.** Destroy or reuse what leaves the screen, cap how many things can spawn, and keep particle bursts short.
- **No everything-against-everything.** With many objects, check hits against the player or what's near, not every pair every frame.
- **The engine guide's Performance section** says what costs most in that engine.

## Music

Every new game has music unless the Creator asked for none. Pick a genre, mood and tempo that fit the game. For a change, touch the music only when the Creator asks for music or a change to it: a game without music stays without it, and a game with music keeps it unless the Creator asks to drop it (`Music: none` with their words).

When the Creator asks for silence ("silent", "no sound", "mute", "quiet"), the game has no music and no sound effects either. When they only say no music, sound effects are fine.

Sound effects make a game feel finished: give every player action, point, hit, win and loss a sound.

Write it once the game is green: `music.mjs` for chiptune, electronic or arcade styles, or `music.py` for acoustic, orchestral, folk, period or world styles played on real instruments. A game has one music file, so when you switch, delete the other. `build` renders it whenever there is one.
