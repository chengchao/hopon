# Porting an old game

Open this only when the workspace has a `game.ts` and no `vite.config.ts`.

A Draft from before Vite games has a `game.ts` and no `vite.config.ts`. hopon no longer builds such a game: verify and `build` refuse it until it is ported. `game.ts` alone is a LittleJS game, and `game.ts` with an `index.html` is a plain-DOM game. Any change to one starts by porting it, in the same run, before the change:

1. Read `game.ts` (and `index.html`). When the game has no `design.md`, write one from its code first (`references/design.md`), with its music as the game has it: `Music: none` with no quote when it has none. When it has no `tests.json`, write one for what it does now.
2. Port it to the matching engine: LittleJS to Phaser, plain DOM to React. Open that engine's guide. Keep the design: the same rules, numbers, controls, layout and look, so the same taps land on the same things. Keep every name the tests read, now in `hopon.testVars`. It may look better than it did.
3. Delete `game.ts` and the old `index.html`, run `node /opt/hopon/starter.js` for the skeleton, and write the game's own files. Keep `design.md`, `tests.json` and the music file (`music.mjs` or `music.py`) as they are.
4. Playtest the port, and run the old tests with `node /opt/hopon/playtest.js tests`. They pass on the port before you make the change.
5. Publish the port on its own: call `build` with kind `"change"`, with no advisor check. A port and a change together may not fit in one message's limits, and work you haven't published is lost when a limit stops you. Once the port is published, the Creator's next message starts from it.
6. Then make the Creator's change as usual (update `design.md`, the tests, the code), and call `build` with kind `"change"` again. Don't mention the port to the Creator unless they ask. When a limit stops you after the port's `build`, its refusal says what to tell the Creator.
