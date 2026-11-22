---
name: make-game
description: How to make or change the Creator's game, from the design to `build`, and what a finished hopon game is. Load it when the Creator asks for a new game or a change to their game, before any other tool. Its references hold the design, tests, engine, sound and music guides. Never load it for chat or a question.
---

# Making a hopon game

You design the game, write it, test it, and publish it with `build`. The Creator sees only your final reply and the game.

A game is played on a phone, in portrait, at least 360 × 640 CSS px and often taller, with one finger: taps, holds and swipes. No hover, no keyboard, no pinch. It uses the whole height and keeps everything inside the screen. Text is at least 18 CSS px, with strong contrast against what's behind it.

## References

This file is the map. The detail of each step is in a reference: open it with `read_skill_resource` (name `make-game` and its path) at the step that names it.

| Reference | What it holds | Open it |
| --- | --- | --- |
| `references/design.md` | The parts of `design.md`, a designed game, and how to change a design | For every game and every change |
| `references/imitation.md` | What to keep of a game the Creator names | Only when the Creator names an existing game to imitate or remake |
| `references/phaser.md`, `references/r3f.md`, `references/react.md` | One engine: its files, API, traps and looks | Step 2, the one engine's only |
| `references/phaser-panels.md` | React panels of words and buttons over a Phaser scene | Step 2, after the Phaser guide, only for a game with such panels |
| `references/phaser-panels-example.md` | A whole game with panels | Only when the panels guide leaves a question |
| `references/tests.md` | `tests.json`, and how a test and a playtest run | Step 3 |
| `references/sound-effects.md` | The scaffold's sounds, and writing the game's own | Step 4 |
| `references/music-synth.md` | Chiptune, electronic and arcade music, as `music.mjs` | Step 7, the one that fits |
| `references/music-sf2.md` | Acoustic, orchestral, folk and world music, as `music.py` | Step 7, the one that fits |
| `references/finish.md` | What a finished game is | Step 9 |
| `references/old-game.md` | Porting a Draft from before Vite games | Only when the workspace has a `game.ts` and no `vite.config.ts`, before anything else |

## The workspace

The workspace holds one game: the files of the game the Creator has now, or nothing before the first one.

- **A new game, a different game, or "Start over":** first empty the workspace and seed the new game's skeleton with this command, then call `build` with kind `"new"`. It deletes every file and folder of the old game, its modules, images and notes too, and keeps only `.hopon/`, where verify.js reads what the Creator said. A `design.md` that `design_game` wrote for this game comes back with the skeleton. Anything left behind would ship in the new game's source.

  ```bash
  find /workspace -mindepth 1 -maxdepth 1 ! -name .hopon -exec rm -rf {} + && node /opt/hopon/starter.js
  ```

- **A change:** edit the existing files and call `build` with kind `"change"`.
- **Until a `build` succeeds, the Creator has no game.** Treat every request until then as a complete new game that includes everything the Creator has asked for so far.

A game is a Vite project: `index.html`, `vite.config.ts`, one `tsconfig.json`, and its code in `src/`, entered at `src/main.tsx`. `node /opt/hopon/starter.js` writes the first three, the same for every engine and every game, and a `src/main.tsx` stub. Keep the three as they are: the game's title and hint are `hopon.title` and `hopon.hint`, set at the top of `src/main.tsx`, and its look lives in its code. Write `src/main.tsx` over the stub. Sound effects are the scaffold's too (`hopon.play`), so a game writes only its own sounds. Pick the engine by what the game is:

- **Phaser** (`references/phaser.md`) for 2D games with motion or a world to move around in: action, arcade, physics, runners, shooters, catchers, flappers, and games on a map, such as role-playing, adventure, strategy and farming games.
- **Phaser with React panels** (`references/phaser.md`, then `references/phaser-panels.md`) when a Phaser game also has panels of words and buttons, such as a shop, an inventory, upgrades or a dialogue. The world is the Phaser scene and the panels are React over it. End its new-game command with `node /opt/hopon/starter.js panels`, which also writes the bridge between them. Never make such a game in React alone, with the world left out. A game with only a score, lives or a timer is plain Phaser.
- **React Three Fiber** (`references/r3f.md`) for 3D games: racers, flyers, 3D runners and dodgers, and anything the Creator calls 3D.
- **React** (`references/react.md`) for cards, quizzes, word games, trivia, and puzzles of tiles or buttons.
- **A vague request:** pick a game with motion, in Phaser, or in r3f when 3D fits it better.
- **When the workspace already has a Vite game, keep its engine.** `src/` importing `phaser` means Phaser (with React panels when it has a `src/panels.tsx`), `@react-three/fiber` means r3f, and React alone means React. Read the game's files before you change anything.

The guides and the skills are not in the workspace, so bash can't see them. Don't explore the workspace either: it holds only the game's files. Each guide's example is a whole game: build your own game from its patterns, with its own design, names, look and rules, never a copy of the example.

## Workflow

1. **Design.** Open `references/design.md`. What a new game is decides who designs it:
   - **An imitation:** the Creator names an existing game ("like Zelda", "a Tetris clone"). Open `references/imitation.md`, and call `design_game` with that game's name as `imitates`.
   - **A kind of game or a big game:** the Creator asks for a genre ("a roguelike", "a farming game") or for a big game. Call `design_game` with no name.
   - **Any other new game:** write `design.md` yourself.

   `design_game` has a designer write `design.md`, and you build from it. For a change, edit `design.md` yourself.

2. **Engine.** Pick the engine and open its guide.
3. **Tests.** Open `references/tests.md` and write `tests.json` from the design's Done-when criteria.
4. **Code.** Open `references/sound-effects.md`, then write the whole game with the write tool: every file the guide names but the skeleton the starter wrote. Give every player action, point, hit, win and loss a sound. Split the code into modules when it grows past a few hundred lines. When the design's Language isn't English, set `hopon.title`, `hopon.hint` and every word of `hopon.text` (`win`, `over`, `score`, `best`, `again`) at the top of `src/main.tsx`, for example `hopon.text = { again: "Toca para jugar otra vez", best: "Récord", over: "Fin del juego", score: "Puntos", win: "¡Ganaste!" };`. For a change, change the existing files with the `edit` tool, and don't rewrite what works.
5. **Playtest.** Call `playtest` with `inputs` that play the game the way a player would: taps where the buttons, cards or targets are, swipes for swipe controls, timed so the game gets going. It typechecks first, and type errors come back with no screenshots.
6. **Fix.** Look at both screenshots. Fix every error and anything that looks wrong or unreadable, then playtest again. Fix with the `edit` tool, changing only the lines that need it: a file written again in full costs the Creator as much as writing it the first time. Screenshots show how the game looks. Your tests and the playtest's `state`, `score` and `overAt` show what the game does (it ends, the score goes up, a swipe moves the player), so don't replay a game only to see that in a screenshot.
7. **Music.** Once the playtest is green, open the music guide that fits and write the music (see Music).
8. **Verify.** In the workspace, run `node /opt/hopon/verify.js new` for a new game, or `node /opt/hopon/verify.js change` for a change (`node /opt/hopon/verify.js change --had-music` when the game had a `music.mjs` or `music.py`). It checks that `design.md`, `tests.json`, the game and, for a new game or a game that had music, the music are all there. Fix everything it lists.
9. **Done check.** Open `references/finish.md`. When verify passes, run your tests with `node /opt/hopon/playtest.js tests` until they pass, then call `ask_advisor` with "Done check." Fix what it finds that the Creator asked for or that is broken, then playtest and run the tests again.
10. **Build.** When the done check is answered and the game does what the Creator asked, call `build` with the game's title, a one-line description for the feed (what the game is and how to play it), kind, and whether it has music. `build` runs verify again, typechecks the game, renders the music, plays the game for a second and runs `tests.json`. If it fails, fix what it lists, playtest, and call `build` again.
11. **Reply.** When `build` succeeds, stop working and write your one reply to the Creator. Don't add features, files or refactors that weren't asked for.

## Asking the advisor

`ask_advisor`'s description names the moments to ask. What it leaves out:

- **The advisor doesn't design.** A game that needs a designer gets one from `design_game` (step 1).
- **The done check goes before `build`, not after.** A `build` that succeeds publishes the game, so advice taken after it would cost a second `build`. When the check finds nothing, call `build`. When `build` then fails, fix what it lists and build again without a second done check.
- **A hard design choice** is one where you can't tell which way is right, such as whether to keep the level data apart from the physics. **A large structural change** is a request such as multiplayer, saves or levels: ask how to restructure first, or whether it fits a hopon game at all.
- **A small, clear change** needs no advice before you make it, only the done check.
- **Follow the advice,** then go on. When the tool says you get no advice, go on without it and call `build` when the game is ready.

## Music

Every new game has music unless the Creator asked for none. For a change, touch the music only when the Creator asks for music or a change to it: a game without music stays without it, and a game with music keeps it unless the Creator asks to drop it (`Music: none` with their words).

When the Creator asks for silence ("silent", "no sound", "mute", "quiet"), the game has no music and no sound effects either. When they only say no music, sound effects are fine.

A game has one music file, `music.mjs` or `music.py`, so when you switch, delete the other. `build` renders it whenever there is one.
