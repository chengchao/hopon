# Sound effects

The scaffold synthesizes every sound: `hopon.play({...})` plays an oscillator or filtered noise with a pitch glide and a short fade. No files, nothing to load. It goes silent when the feed mutes the game, stops while the feed has it paused, and starts at the player's first touch, as iOS requires. The scaffold plays the music too.

## src/sfx.ts

The game's own sounds, one per thing that happens. Start from these and change, add or drop sounds to fit the game:

```ts
export const sfx = {
  tap: () => hopon.play({ freq: 520, ms: 50, volume: 0.15, wave: "triangle" }),
  coin: () => {
    hopon.play({ freq: 990, ms: 70, volume: 0.2 });
    hopon.play({ delayMs: 70, freq: 1320, ms: 140, volume: 0.2 });
  },
  jump: () => hopon.play({ freq: 280, ms: 160, to: 620, volume: 0.2 }),
  hit: () =>
    hopon.play({ freq: 1200, ms: 220, to: 200, volume: 0.4, wave: "noise" }),
  wrong: () =>
    hopon.play({ freq: 220, ms: 220, to: 150, volume: 0.25, wave: "sawtooth" }),
  win: () => {
    for (const [i, freq] of [523, 659, 784, 1047].entries()) {
      hopon.play({ delayMs: i * 110, freq, ms: 160, volume: 0.22 });
    }
  },
  lose: () =>
    hopon.play({ freq: 440, ms: 700, to: 110, volume: 0.3, wave: "sawtooth" }),
};
```

`hopon.play` takes `freq` and `ms`, and optionally `to` (the pitch it glides to, `freq` by default), `wave` (`"square"` by default, `"triangle"`, `"sine"`, `"sawtooth"` or `"noise"`), `volume` (0.3 by default) and `delayMs` (start this long after the call, for the second note of a jingle).

## Using it

- `import { sfx } from "./sfx";` then call `sfx.coin()` when a coin is caught, `sfx.hit()` when the player is hit, `sfx.win()` or `sfx.lose()` next to `hopon.gameOver(...)`.
- Pitch: 80 to 200 Hz thuds and booms, 300 to 700 jumps and taps, 800 to 2000 coins and sparkles. A rising glide (`to` above `freq`) sounds like a jump or a power-up; a falling one sounds like a hit or a loss. `square` and `sawtooth` are bright and retro, `triangle` and `sine` soft, `noise` is hits, whooshes and explosions (a falling `noise` from 600 to 60 Hz over 600 ms is an explosion).
- Keep effects short: under 300 ms for frequent ones, up to 1 s for the win and the loss.
- Every player action gets a sound, and so do points, hits, the win and the loss. That is what makes a game feel finished.
- Play a sound when something happens, never every frame: a sound started in an update loop without a guard plays 60 times a second.
- The loudest sounds are rare ones (a crash, the win). A sound heard every second stays at 0.1 to 0.2.
- When the Creator asked for silence ("silent", "no sound", "mute", "quiet"), the game has no `sfx.ts` and plays nothing.
