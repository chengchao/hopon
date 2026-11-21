# A finished game

Open this at step 9, before the done check. Every line is true of a game that is ready for `build`.

- **It starts and moves.** The scaffold's start screen takes the first tap and sets `hopon.state` to `"play"`. Within a second something happens on screen. Nothing advances before that.
- **The controls work on the first touch,** where the design puts them, and do what it says. A tap target is at least 48 CSS px across.
- **It ends.** The player can lose, and win when the game has a win. The game then calls `hopon.gameOver()`, and the scaffold's tap starts a fresh round, in which the game resets everything.
- **It stops when the feed pauses it** (`hopon.paused`), and goes silent when the feed mutes it.
- **The rules are the ones on screen.** What hits, scores and hurts matches what the player sees. Nothing that matters is off screen or too small to see.
- **No dead ends.** No state where nothing can happen and the game hasn't ended: a level with no way forward, a timer that never runs out, a board with no move left.
- **Every Done-when criterion is met,** shown by the tests, the playtest's `state`, `score` and `overAt`, or its screenshots.
- **It is fair.** The engine guide's "Fair games" and "Hits and collisions" sections are the most common reasons a green game still isn't playable.
- **It runs smoothly.** The engine guide's Performance section says what costs most in that engine.
