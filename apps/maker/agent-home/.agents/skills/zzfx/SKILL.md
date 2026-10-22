---
name: zzfx
description: More ZzFX sound effects for a LittleJS game, and how to tune one. Read only when the game needs a sound that littlejs-api's four starting points don't cover.
---

# ZzFX sounds

Every LittleJS sound is a ZzFX array, synthesized in the runtime: no files. Make each sound once at top level with `new Sound([...])`, then call `.play()` when it happens. Plain-DOM games have no sound.

## The parameters, in order

`[volume, randomness, frequency, attack, sustain, release, shape, shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay, sustainVolume, decay, tremolo, filter]`

- `volume` 0–1.5. `randomness` 0–1 varies the pitch on each play, so repeats don't grate (0.05 is the default).
- `frequency` Hz: 80–200 thuds and booms, 300–700 jumps and taps, 800–2000 coins and sparkles.
- `attack`, `sustain`, `release` seconds. Keep the total under 0.5 s for effects; stingers can run to 1 s.
- `shape` 0 sine (soft), 1 triangle (round), 2 saw (bright), 3 tan (harsh), 4 noise (hits, explosions).
- `slide` Hz/s: positive rises (power-up), negative falls (hit, lose). `pitchJump` Hz at `pitchJumpTime` s: the two-note "ding" of a coin.
- `noise` adds grit, `bitCrush` makes it retro, `delay` adds an echo, `filter` below 0 muffles it.

## More starting points

```ts
const tap = new Sound([0.4, 0, 500, 0, 0.02, 0.05, 1]); // button, card flip
const laser = new Sound([0.5, 0.05, 900, 0, 0.05, 0.1, 2, 1, -40]); // shot
const powerUp = new Sound([0.7, 0, 300, 0.02, 0.15, 0.2, 1, 1, 15]); // power-up, level up
const bounce = new Sound([0.5, 0.1, 250, 0, 0.03, 0.08, 0, 1, 8]); // ball off a wall
const explosion = new Sound([
  1.2, 0.2, 80, 0.01, 0.3, 0.6, 4, 1, -2, 0, 0, 0, 0, 0.5,
]); // explosion
const lose = new Sound([1, 0, 300, 0.05, 0.3, 0.6, 2, 1, -8, 0, -60, 0.2]); // game over
```

## Using them well

- Every player action gets a sound, and so do points, hits, the win and the loss. That is what makes a game feel finished.
- Play a sound when something happens, never every frame: a sound started in `gameUpdate` without a guard plays 60 times a second.
- The loudest sounds are rare ones (crash, win); a sound heard every second stays at 0.3–0.5.
- `sound.play(pos)` pans it by its position on screen.
