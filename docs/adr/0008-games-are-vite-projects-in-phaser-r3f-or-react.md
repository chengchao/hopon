# 8. Games are Vite projects in Phaser, React Three Fiber or React

## Status

Proposed. It builds on ADR 0006 (one agent, game making as a skill) and ADR 0007 (shared, frozen vendor files). It ends the authoring of LittleJS and plain-DOM games that ADR 0003 and ADR 0005 described.

## Context

The Maker wrote every game as one `game.ts`: LittleJS for games with motion, plain DOM for cards, quizzes and puzzles. ADR 0007 put Vite, React 19, Phaser 4, three and React Three Fiber in the box and on the Worker, and taught the harness to build and play a workspace with a `vite.config.ts`. The agent still wrote LittleJS and plain DOM, because its skills said so. The eval's judge scored the looks of those games about 3.1 to 3.7 out of 5: LittleJS draws flat shapes unless the model works hard, and it has no 3D at all.

## Decision

- **Three engines, one layout.** A new game is a Vite project: `index.html` loading `/hopon/v1.js` and then `src/main.tsx`, `vite.config.ts` with `@vitejs/plugin-react`, and one `tsconfig.json` whose `include` is `src`. 2D games with motion are Phaser 4.2.1, 3D games are React Three Fiber 9.8.2 on three 0.187.0, and card, quiz, word and puzzle games are React 19.3.1. A vague request gets a game with motion.
- **One skill per engine.** `phaser-games`, `r3f-games` and `react-games` each give the project's files, the wiring to the scaffold, the engine's API and its traps at the box's version, touch controls, fair hits, performance, how to make the game look good, and one complete example that passed the box's check. `sound-effects` gives `src/sfx.ts`, a small Web Audio synth that follows the feed's mute and pause. `make-game` picks the engine. `littlejs-api`, `dom-games` and `zzfx` are deleted. The skills' fingerprint is `v11`.
- **Phaser draws at the phone's pixel ratio, in CSS px.** Phaser 4 has no `resolution` setting, so the game is the viewport's size times `min(devicePixelRatio, 2)`, and the main camera zooms by the same factor. World coordinates are CSS px, which is what a test's taps are. The box's Chromium has a pixel ratio of 1, so a playtest draws 360 px wide and stays fast.
- **An old Draft is ported before it changes.** A workspace with a `game.ts` and no `vite.config.ts` is a LittleJS game (`game.ts` alone) or a plain-DOM one (with an `index.html`). `verify.js` refuses it, so `build` does too, with a sentence that points to make-game's "An old game". The agent ports it in the same run: LittleJS to Phaser, plain DOM to React, keeping `design.md`, `tests.json` and the music file, and the names the tests read, now in `hopon.testVars`. The old tests pass on the port before the change is made.
- **The box still builds a `game.ts`.** Its esbuild path, `/runtime/v4.js`, `/dom/v4.js` and their declarations stay, so the agent can playtest an old Draft before it ports it, and the harness's own cases keep their LittleJS fixtures. Every frozen `/runtime/v2–v4.js` and `/dom/v1–v4.js` stays served for published Games.
- **`/hopon/v1.js` is frozen.** Its sha256 is `HOPON_V1_SHA256` in `apps/maker/src/runtime.ts`, `build:runtime` refuses a changed scaffold, and the Worker serves it `immutable`. Before freezing it, the overlay's start tap stopped reaching the game: the overlay hides on its press, so the release, the touchend and the click that follow were landing on the game, and an r3f game that steers on `pointerup` changed lane at the start. The scaffold now swallows each once. A change from here ships as `/hopon/v2.js`.
- **The playtest's clock runs every frame.** The fake clock derived its next frame from the current time, so a timer due at a frame's instant skipped that frame: a game with a 100 ms timer ran about a sixth slow. A callback that throws is now the page's error, which fails the check with its message, rather than a crash of the harness.

## Alternatives rejected

- **Phaser 3.90 beside Phaser 4.** The model knows Phaser 3 better, but a second file needs its own specifier, types and URL, and the agent would still have to pick one. The `phaser-games` skill names the Phaser 3 habits that fail on 4 instead. The eval decides whether that is enough.
- **Phaser at a fixed 720 px width.** It is sharp on phones, but every tap in a test is half the game's coordinates, and a playtest in the box drew four times the pixels and took about 2.5 times as long.
- **Dropping the box's LittleJS build.** It would remove `runtime.js` from the image, but the agent could no longer play an old Draft before porting it, and two dozen harness cases would need new fixtures. Its cost is a few files in the image.
- **A round counter in the scaffold.** Each engine resets on the state's change from `over` to `play`, which the skills show. A counter would save a few lines a game, and the skills' examples already work without it.

## Consequences

- New Games load `/hopon/v1.js` and the `/vendor/` files. A Game published before this change keeps its frozen scaffold.
- A change to an old Draft costs more the first time, since the agent ports it. The port can change how the game feels; its tests pass, but its feel is checked only by the eval.
- The engine skills are long, about 1,000 lines each, most of it the example. A run loads one of them.
- The eval's final checks build Vite games on the developer's machine, so `apps/maker` has the React and three types, and the playtest's Chromium uses SwiftShader there.
