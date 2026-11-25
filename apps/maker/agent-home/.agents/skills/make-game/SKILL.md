---
name: make-game
description: How to make or change the Creator's game, from the design to `build`, and what a finished hopon game is. Load it when the Creator asks for a new game or a change to their game, before any other tool. Its references hold the design, tests, engine, sound and music guides. Never load it for chat or a question.
---

# Making a hopon game

You design the game, write it, test it, and publish it with `build`. The Creator sees only your final reply and the game.

A game is played on a phone, in portrait, at least 360 × 640 CSS px and often taller, with one finger: taps, holds and swipes. No hover, no keyboard, no pinch. It uses the whole height and keeps everything inside the screen. Text is at least 18 CSS px, with strong contrast against what's behind it.

This file holds what is true of every game. The detail of each kind of work is in a reference: open one with `read_skill_resource` (name `make-game` and its path) when its row below says so, and not before.

## References

| Reference | What it holds | Read it when |
| --- | --- | --- |
| `references/design.md` | The parts of `design.md`, a designed game, and how to change a design | You write or edit `design.md` |
| `references/imitation.md` | What to keep of a game the Creator names | The Creator names an existing game to imitate or remake |
| `references/phaser.md` | Phaser: its files, API, traps and looks | The game is in Phaser |
| `references/phaser-scenes.md` | One scene for each screen, and moving between them | A Phaser game has more than one screen |
| `references/phaser-panels.md` | React panels of words and buttons over a Phaser scene | A Phaser game has such panels |
| `references/phaser-example.md`, `references/phaser-panels-example.md` | A whole small game each | A playtest fails and the guide doesn't say why |
| `references/r3f.md` | React Three Fiber: its files, API, traps and looks | The game is in React Three Fiber |
| `references/react.md` | React: its files, API, traps and looks | The game is in React |
| `references/tests.md` | `tests.json`, and how a test and a playtest run | You write `tests.json` or a playtest's inputs |
| `references/sound-effects.md` | The scaffold's sounds, and writing the game's own | You write the game's sounds |
| `references/music-synth.md` | Chiptune, electronic and arcade music, as `music.mjs` | The game's music is of that kind |
| `references/music-sf2.md` | Acoustic, orchestral, folk and world music, as `music.py` | The game's music is of that kind |
| `references/old-game.md` | Porting a Draft from before Vite games | The workspace has a `game.ts` and no `vite.config.ts` |

The references and the skills are not in the workspace, so bash can't see them. Don't explore the workspace either: it holds only the game's files.

## A finished game

`build` publishes the game, and refuses one that lacks any of these:

- **`design.md`:** what the game is. Everything else is made from it.
- **`tests.json`:** automated checks of what the Creator asked for, which all pass.
- **The game:** a Vite project that typechecks and plays without an error.
- **Music:** `music.mjs` or `music.py`, unless the Creator asked for none (see Music).

And a game is ready for `build` only when every line here is true of it:

- **It starts and moves.** The scaffold's start screen shows the game's title and hint, takes the first tap, and sets `hopon.state` to `"play"`. Within a second something happens on screen. Nothing advances before that. The game has no title screen of its own.
- **The controls work on the first touch,** where the design puts them, and do what it says. A tap target is at least 48 CSS px across.
- **It ends.** The player can lose, and win when the game has a win. The game then calls `hopon.gameOver()`, and the scaffold's end screen and its tap start a fresh round, in which the game resets everything.
- **It stops when the feed pauses it** (`hopon.paused`), and goes silent when the feed mutes it.
- **The rules are the ones on screen.** What hits, scores and hurts matches what the player sees. Nothing that matters is off screen or too small to see.
- **No dead ends.** No state where nothing can happen and the game hasn't ended: a level with no way forward, a timer that never runs out, a board with no move left.
- **Every Done-when criterion of the design is met,** shown by the tests, the playtest's `state`, `score` and `overAt`, or its screenshots.
- **It is fair and runs smoothly.** The engine guide's "Fair games", "Hits and collisions" and Performance sections name the most common reasons a green game still isn't playable.
- **Every player action, point, hit, win and loss has a sound.**

## The workspace

The workspace holds one game: the files of the game the Creator has now, or nothing before the first one.

- **A new game, a different game, or "Start over":** first empty the workspace and seed the new game's skeleton with this command, then call `build` with kind `"new"`. It deletes every file and folder of the old game, its modules, images and notes too, and keeps only `.hopon/`, where verify.js reads what the Creator said. A `design.md` that `design_game` wrote for this game comes back with the skeleton. Anything left behind would ship in the new game's source.

  ```bash
  find /workspace -mindepth 1 -maxdepth 1 ! -name .hopon -exec rm -rf {} + && node /opt/hopon/starter.js
  ```

- **A change:** edit the existing files and call `build` with kind `"change"`.
- **Until a `build` succeeds, the Creator has no game.** Treat every request until then as a complete new game that includes everything the Creator has asked for so far.

A game is a Vite project: `index.html`, `vite.config.ts`, one `tsconfig.json`, and its code in `src/`, entered at `src/main.tsx`. `node /opt/hopon/starter.js` writes the first three, the same for every engine and every game, and a `src/main.tsx` stub. Keep the three as they are: the game's title and hint are `hopon.title` and `hopon.hint`, set at the top of `src/main.tsx`, and its look lives in its code. Write `src/main.tsx` over the stub.

## The design comes first

`design.md` is written before any code. What a new game is decides who writes it:

- **An imitation:** the Creator names an existing game ("like Zelda", "a Tetris clone"). Call `design_game` with that game's name as `imitates`.
- **A kind of game or a big game:** the Creator asks for a genre ("a roguelike", "a farming game") or for a big game. Call `design_game` with no name.
- **Any other new game:** write `design.md` yourself.

`design_game` has a designer write `design.md`, and you build every part of it. For a change, edit `design.md` yourself, before the code.

## The engine

Pick the engine by what the game is, and read its guide, and only its guide, before you write code:

- **Phaser** for 2D games with motion or a world to move around in: action, arcade, physics, runners, shooters, catchers, flappers, and games on a map, such as role-playing, adventure, strategy and farming games.
- **Phaser with React panels** when a Phaser game also has panels of words and buttons, such as a shop, an inventory, upgrades or a dialogue. The world is the Phaser scene and the panels are React over it. End its new-game command with `node /opt/hopon/starter.js panels`, which also writes the bridge between them. Never make such a game in React alone, with the world left out. A game with only a score, lives or a timer is plain Phaser.
- **React Three Fiber** for 3D games: racers, flyers, 3D runners and dodgers, and anything the Creator calls 3D.
- **React** for cards, quizzes, word games, trivia, and puzzles of tiles or buttons.
- **A vague request:** pick a game with motion, in Phaser, or in React Three Fiber when 3D fits it better.
- **When the workspace already has a Vite game, keep its engine.** `src/` importing `phaser` means Phaser (with React panels when it has a `src/panels.tsx`), `@react-three/fiber` means React Three Fiber, and React alone means React. Read the game's files before you change anything.

## Writing the game

- **Tests before code.** Write `tests.json` from the design's Done-when criteria, then the game that passes them.
- **One file, one `write` call.** Write each file with the `write` tool, never with a shell command that prints into a file: the Creator's progress and the done check both read your `write` calls. Change a file with the `edit` tool, touching only the lines that need it. A file written again in full costs the Creator as much as writing it the first time.
- **Rules apart from the screen.** When the game has turns, prices, an inventory, a map or levels, keep that state and its rules in a module that imports nothing from the engine or from React. What draws the game reads the state and calls a rule when the player acts. A new round is then a new state.
- **Small files.** Split the code into modules when one grows past a few hundred lines. A game with several screens has a file for each.
- **The game's own words.** When the design's Language isn't English, set `hopon.title`, `hopon.hint` and every word of `hopon.text` (`win`, `over`, `score`, `best`, `again`) at the top of `src/main.tsx`, for example `hopon.text = { again: "Toca para jugar otra vez", best: "Récord", over: "Fin del juego", score: "Puntos", win: "¡Ganaste!" };`.
- **Only what was asked.** Don't add features, files or refactors the Creator didn't ask for. For a change, don't rewrite what works.

## Playing and fixing

- **`playtest` plays the game** with the `inputs` you give it: taps where the buttons, cards or targets are, swipes for swipe controls, timed so the game gets going. It typechecks first, and type errors come back with no screenshots.
- **Look at both screenshots.** Fix every error and anything that looks wrong or unreadable, then playtest again.
- **Screenshots show how the game looks. Values show what it does.** Your tests and the playtest's `state`, `score` and `overAt` show that it ends, that the score goes up, that a swipe moves the player. Don't replay a game only to see that in a screenshot.
- **`node /opt/hopon/playtest.js tests`** runs `tests.json` in the workspace.
- **Check a rule by calling it.** What lies deep in a game, such as a battle, a late level or the win, is slow to reach with taps. When the rules are a module of their own, import it in a short script and run it with `node`: start from the state you need, call the rule, print what it gives. Never change the game to reach a state sooner.

## Music

Every new game has music unless the Creator asked for none. Write it once the playtest is green, from the music guide that fits, to `design.md`'s Music line: its tempo, meter, key, instruments and feel. For a change, touch the music only when the Creator asks for music or a change to it: a game without music stays without it, and a game with music keeps it unless the Creator asks to drop it (`Music: none` with their words).

When the Creator asks for silence ("silent", "no sound", "mute", "quiet"), the game has no music and no sound effects either. When they only say no music, sound effects are fine.

A game has one music file, `music.mjs` or `music.py`, so when you switch, delete the other. `build` renders it whenever there is one.

## Before `build`

`build` publishes at once, so everything that could change the game comes before it, in this order:

1. **Verify.** In the workspace, run `node /opt/hopon/verify.js new` for a new game, or `node /opt/hopon/verify.js change` for a change (`node /opt/hopon/verify.js change --had-music` when the game had a `music.mjs` or `music.py`). It checks that `design.md`, `tests.json`, the game and the music are all there. Fix everything it lists.
2. **The tests pass.** Run them until they do.
3. **The done check.** Call `ask_advisor` with "Done check." Fix what it finds that the Creator asked for or that is broken, then playtest and run the tests again.
4. **`build`,** with the game's title, a one-line description for the feed (what the game is and how to play it), kind, and whether it has music. It runs verify again, typechecks the game, renders the music, plays the game for a second and runs `tests.json`. If it fails, fix what it lists, playtest, and call `build` again, without a second done check.

When `build` succeeds, stop working and write your one reply to the Creator.

## Asking the advisor

`ask_advisor`'s description names the moments to ask. What it leaves out:

- **The advisor doesn't design.** A game that needs a designer gets one from `design_game`.
- **The done check goes before `build`, not after.** A `build` that succeeds publishes the game, so advice taken after it would cost a second `build`.
- **A hard design choice** is one where you can't tell which way is right, such as whether to keep the level data apart from the physics. **A large structural change** is a request such as multiplayer, saves or levels: ask how to restructure first, or whether it fits a hopon game at all.
- **A small, clear change** needs no advice before you make it, only the done check.
- **Follow the advice,** then go on. When the tool says you get no advice, go on without it and call `build` when the game is ready.
