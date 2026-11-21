# Tests and the playtest

Open this at step 3, with the design written and the engine's guide open.

## tests.json

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

The page is served under a path, as on the phone: a file named by an absolute path such as `/ship.png` isn't found, so import every asset from `src/`. `state "over"` within 3 s of the start is a warning: the game ends before a player can act, so make it more forgiving.
