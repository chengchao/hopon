---
name: building-games
description: "What a finished hopon game is, whatever the engine: playable and correct, made for a phone, smooth, with music. Load first on every job, then the engine's skill."
---

# Building a hopon game

Build a **playable, correct** browser game — not a static screenshot. It is played on a phone, in portrait, by touch. The engine's skill (`littlejs-api` or `dom-games`) says how; this one says what done looks like.

## Playable and correct

- **It starts and moves.** The tap that starts the game starts it, and within a second something happens on screen.
- **The controls work on the first touch,** where the brief puts them, and do what the brief says. A tap target is at least 48 CSS px across.
- **It ends.** The player can lose, and win when the brief has a win; the game then calls `hopon.gameOver()`, and a tap starts a fresh round with everything reset.
- **The rules are the ones on screen.** What hits, scores and hurts matches what the player sees; nothing that matters is off screen or too small to see.
- **No dead ends.** No state where nothing can happen and the game hasn't ended: a level with no way forward, a timer that never runs out, a board with no move left.
- **Every "Done when:" criterion is met,** and your playtest shows it.

## Made for a phone

- Portrait, at least 360×640 CSS px and often taller: use the whole height, keep everything inside the screen, and keep clear of the score in the top-left corner.
- Touch only: taps, holds and swipes with one finger. No hover, no keyboard, no right-click, no pinch.
- Text at least 18 CSS px, with strong contrast against what's behind it.

## Performance

Aim for a steady 60 frames a second on a mid-range phone: a frame has about 16 ms for the game, the drawing and the browser together.

- **Minimize draw calls.** LittleJS batches shapes and sprites on WebGL until a draw switches texture, which flushes the batch: draw the things that share a sprite one after another, and keep the number of sprite textures small.
- **Text isn't batched.** `drawText` and `drawTextScreen` draw with Canvas 2D: keep text to the HUD and a few labels, never a label on every object every frame.
- **Make things once.** Sprites, textures, sounds and gradients at top level or in `gameInit`, never in `gameUpdate` or `gameRender`.
- **Keep counts bounded.** Destroy what leaves the screen, cap how many things can spawn, and keep particle emitters short (`emitTime` well under a second, a modest `emitRate`).
- **No everything-against-everything.** With many objects, check hits against the player or what's near, not every pair every frame.
- **Backgrounds are a few big shapes,** not hundreds of small ones redrawn each frame.
- **Plain DOM:** animate `transform` and `opacity`, not `top`, `left`, `width` or `height`; change only the elements that changed, never rebuild the page with `innerHTML` every frame; don't read layout (`getBoundingClientRect`, `offsetWidth`) inside a loop; don't animate `box-shadow` or `filter`.

## Music

Every game has music unless the Creator said they don't want it. The job's "Music:" line says what to do this time: when it asks for music, load the `music-synth` skill and write `music.mjs` once the game is green; when it says none, leave any existing `music.mjs` as it is.
