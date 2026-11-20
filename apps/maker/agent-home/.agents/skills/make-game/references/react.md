# Writing a React hopon game

React is the engine for games of taps on cards, answers, letters, tiles and buttons, such as memory, quizzes, trivia, word games, and sliding or flipping puzzles. Things that move every frame belong to Phaser or React Three Fiber.

## The project

A React game is a Vite project in the workspace:

- `index.html`, `vite.config.ts` and `tsconfig.json`, the skeleton `node /opt/hopon/starter.js` wrote (make-game). Keep them as they are.
- Set `hopon.title` and `hopon.hint` at the top of `main.tsx`: the start screen's title and the line under it.
- `src/main.tsx` is the entry. It renders the game and wires it to hopon.
- `src/style.css` is the look, imported once from `main.tsx`.
- One or more `src/*.ts` files for the rules, with no React in them.
- `tests.json`, `design.md`, and the music, as `make-game` says.

The rules of the box:

- **Imports.** `react`, `react-dom/client`, and your own files. The JSX runtime comes on its own. Any other React path (`react-dom`, `react/jsx-dev-runtime`) fails the build. No other npm package exists, so no router, no state library, no CSS framework and no icon set.
- **Files.** Import a picture or a font from `src/` (`import moon from "./moon.png"`) and use the URL it gives. Never write an absolute path such as `"/moon.png"`. The game is served under a folder, so it won't load. The only absolute paths are the two in `index.html`.
- **Nothing from the web.** No fetch, no web fonts, no CDN. Use system fonts (`system-ui`), emoji, inline SVG and CSS.
- **Sound effects.** Read `references/sound-effects.md`. The scaffold plays the music.

## Wiring to hopon

The scaffold (`/hopon/v2.js`, the global `hopon`) owns the start screen, the over screen and the score. It covers the game in "start" and "over" with a dimmed overlay that shows the title, the score and the best score, and it takes the tap that starts a round. That tap never reaches the game. During "play" the scaffold draws nothing, so the game shows its own score.

```tsx
import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { newGame, tap, tick } from "./rules";
import "./style.css";

hopon.title = "Pairs";
hopon.hint = "Tap the cards to find pairs";

let round = 0;
let lastState = hopon.state;
hopon.subscribe(() => {
  if (hopon.state === "play" && lastState !== "play") {
    round += 1;
  }
  lastState = hopon.state;
});

const useHopon = <T,>(read: () => T) =>
  useSyncExternalStore(hopon.subscribe, read);

const Board = () => {
  const [game, setGame] = useState(newGame);
  const state = useHopon(() => hopon.state);
  const paused = useHopon(() => hopon.paused);
  const running = state === "play" && !paused;

  useEffect(() => {
    if (!running) {
      return;
    }
    const id = setInterval(() => setGame((now) => tick(now, 100)), 100);
    return () => clearInterval(id);
  }, [running]);

  const press = (index: number) => {
    if (state !== "play") {
      return;
    }
    const next = tap(game, index);
    if (next.found > game.found) {
      hopon.addScore(1);
    }
    if (next.won) {
      hopon.gameOver(true);
    }
    setGame(next);
  };

  hopon.testVars.found = game.found;
  return <main className="game">{/* the HUD, the board, the footer */}</main>;
};

const App = () => {
  useEffect(() => hopon.ready(), []);
  return <Board key={useHopon(() => round)} />;
};

const root = document.querySelector("#root");
if (root) {
  createRoot(root).render(<App />);
}
```

What each part does:

- **`hopon.ready()`** once the first screen is drawn, from an effect in the root component. Without it the build fails after 10 s.
- **A new round is a new board.** `round` counts the times the state became "play". `<Board key={round}>` throws the old board away and mounts a fresh one with fresh state, so a restart resets everything with no reset code. The subscribe that counts rounds sits at the top of `main.tsx`, so it runs before React reads `round`.
- **`useSyncExternalStore(hopon.subscribe, () => hopon.state)`** re-renders when the scaffold changes. The read function returns one primitive (a string, number or boolean), never a new object, or React renders forever.
- **Play only while `running`.** Timers, countdowns and moves run only when the state is "play" and the game is not paused. In "start" the board sits still behind the overlay. `hopon.paused` means the feed scrolled the game away. The clock stops and starts again where it was.
- **The score is the scaffold's.** Call `hopon.addScore(n)` when the player earns points and `hopon.gameOver(won)` when the round ends. Show the score with `useHopon(() => hopon.score)`.
- **Call hopon from event handlers and effects,** never from inside a `setGame((now) => ...)` updater. React may run an updater twice or later.
- **`hopon.testVars`** holds what `tests.json` reads. Write it in the render body from the state you are drawing, so the tests see exactly what is on screen.

## Game state

- **One object holds the game.** Board, turn, level, moves, time left and phase go in one `Game` value. Things that change together stay consistent, and a test variable is one field away.
- **Rules are pure functions** in their own file, such as `newGame()`, `tap(game, index)` and `tick(game, ms)`. Each returns the next `Game` and never changes the one it was given (`{ ...game, moves: game.moves + 1 }`, `cards.map(...)`). When a tap does nothing, return the same object, so the handler can tell.
- **The handler** works out the next state with the rule, sets it, and tells hopon what changed by comparing the two (`next.found > game.found`). `useReducer` works too, with no hopon calls inside the reducer.
- **One clock.** One `setInterval` while `running` drives every timed thing, such as the countdown, a mismatch turning back down, or a "level cleared" banner before the next board. Use a phase field (`"playing" | "cleared"`) and the time spent in it, not a `setTimeout` per event. A game whose only timer is short can use `useEffect` with `setTimeout` instead, as long as the effect depends on `paused` and clears its timer.
- **Every effect cleans up.** An effect that starts a timer, a listener or an animation frame returns the function that stops it. A missing cleanup leaves two clocks running after a restart.
- **Never drive the game from `onAnimationEnd` or `onTransitionEnd`.** CSS runs on real time, the game on game time (see Checking your work), and a paused game's CSS still ends. The game state decides; CSS only shows it.
- **Keys.** A fixed grid that never reorders can use the index. A list that shuffles, grows or loses items needs a stable `id` on each item. A changing key remounts an element. Use it to reset a round (`key={round}`) or to replay a CSS animation (`<div className="banner" key={level}>`).
- **No `async` chains for game logic.** Drive it from the clock and from taps. A chain of `await`s between moves can run late in the playtest.

## Layout on a phone

The phone is portrait, but the app plays a game in a frame that can be much shorter than the screen: about 570 px tall on a 6.1" iPhone, less on a small one. Fill the height and keep every control on screen from 360×540 up. Anything past the bottom is cut off and can't be tapped, so a quiz with its fourth answer below the frame can't be played.

```css
html,
body,
#root {
  margin: 0;
  height: 100%;
}
.game {
  box-sizing: border-box;
  height: 100dvh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: min(12px, 2dvh);
  padding: 16px 16px 24px;
}
.board {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}
.grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
  width: min(100%, 420px, 60dvh);
}
```

- Lay the screen out as a column, with the HUD at the top (score, level), the board in the middle taking the free space (`flex: 1 1 0; min-height: 0`), and controls or a timer at the bottom.
- **The middle gives way, the controls never do.** Only the middle shrinks on a short screen: a picture, a question, a board. The answers and buttons keep their size (`flex: none`). Without `min-height: 0` a flex child won't shrink below its content, and the controls are pushed off the bottom.
- Size what's only for looks by the height, so it shrinks with the frame: an emoji or a picture at `font-size: clamp(32px, 11dvh, 76px)`. No `min-height` on text, and buttons at `min-height: min(60px, 9dvh)`.
- Add it up for 540 px: the padding, the gaps, the HUD and every button. If the controls alone don't fit, as with a long list of choices, put them in a box with `overflow-y: auto` so they scroll, never past the frame's bottom. The playtest fails a game with a control off a 360×540 screen.
- Size a square board by both sides. `width: min(100%, 420px, 60dvh)` keeps it inside a short screen and a wide one. Pieces get `aspect-ratio: 1`.
- Sizes in `px`, `%`, `vw` and `dvh`, never a fixed 640. Use `dvh`, not `vh`. Mobile browsers' `vh` includes the hidden toolbar.
- Text at least 18 px, game pieces at least 48 px, emoji on a piece at least 24 px.
- Hidden means hidden. A card face down shows no hint of its face, and something "off" takes `opacity: 0` or `visibility: hidden` rather than staying drawn over its neighbour.

## Touch

- **`onPointerDown` for game pieces.** It fires the moment the finger lands, so a tap feels instant, and a tap that slides a few pixels still counts. `onClick` waits for the finger to lift and is fine for a menu button.
- **Every target is at least 48 px** and as big as it looks. A piece with padding around its drawing takes taps on the padding too.
- **No hover.** Give feedback on press with `:active` (a scale or a push down).
- **On the page:** `touch-action: manipulation` (no double-tap zoom), `user-select: none` (no text selection on a long press), `-webkit-tap-highlight-color: transparent` (no grey flash).
- **Buttons are `<button type="button">`** with `border: 0; padding: 0; background: none;` reset, then styled.
- **Swipes** (sliding tiles, 2048) go on the board. Note where the finger lands, and on lift take the larger of the two moves when it is over 30 px. Give the board `touch-action: none` so the page doesn't scroll instead. A drag reads `event.clientX` and `clientY` in `onPointerMove` while a finger is down. A hold starts on `onPointerDown` and ends on `onPointerUp` or `onPointerCancel`.

```tsx
const start = useRef<{ x: number; y: number } | null>(null);
<div
  className="board"
  onPointerDown={(event) => {
    start.current = { x: event.clientX, y: event.clientY };
  }}
  onPointerUp={(event) => {
    const from = start.current;
    start.current = null;
    if (!from) {
      return;
    }
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) {
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) {
      slide(dx > 0 ? "right" : "left");
    } else {
      slide(dy > 0 ? "down" : "up");
    }
  }}
/>;
```

## Fair puzzles and quizzes

- **Every board can be solved.** Build a puzzle by scrambling the solved board with legal moves (slides, flips, swaps), never by filling it at random. A random sliding puzzle is unsolvable half the time. Keep the moves you made. They are the solution and the hint.
- **No dead ends.** When no move is left (no pair, no match, no word), reshuffle or end the round. A timer always runs out. A stuck player gets a hint after a few seconds, such as a piece that nudges.
- **Quizzes.** Every question has exactly one right answer, the answers are shuffled so the right one isn't always in the same place, and a wrong answer shows the right one for about a second before the next question. Questions fit on screen and give the player time to read them (at least 5 s with a timer).
- **Shuffle fairly.** Swap each item with a random one at or before it, from the end down (Fisher and Yates). `sort(() => Math.random() - 0.5)` leaves some orders far likelier than others.

```ts
function shuffled<T>(items: T[]) {
  const deck = [...items];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
```

- **Memory games** show a mismatch for at least 0.8 s before the cards turn back.
- **Matching games** compare what the pieces show, not their ids, so every match the player can see counts.
- **Difficulty ramps by level:** more scramble moves, a bigger grid, less time. Level 1 should be solvable by a first-time player within 10 s.

## Performance

- **Animate `transform` and `opacity` only.** They run on the GPU. Animating `width`, `top`, `box-shadow`, `filter` or a gradient makes the browser repaint every frame. To fade a glow or swap a gradient, put it on a pseudo-element and animate its `opacity`.
- **Re-render what changes.** A board of up to 100 buttons re-renders in well under a millisecond, so a 10-a-second clock tick over the whole board is fine. With hundreds of pieces, or a piece that is expensive to draw, wrap the piece in `memo` and pass it only primitive props and a stable callback.
- **Don't make things in render that last.** Build decks, word lists and boards in `newGame()`, not on every render.
- **One clock** (one `setInterval`), not a timer per piece.
- **No layout reads in a loop** (`getBoundingClientRect`, `offsetWidth`).
- **Keep the DOM small:** a few hundred elements at most. Decoration goes in CSS backgrounds and pseudo-elements, not in hundreds of `<div>`s.

## Make it look good

The judge looks at the screenshots first. A game that plays well but looks like a web form loses. Spend as much care on `style.css` as on the rules, about a third of the code.

**Palette.** 4 to 6 colours that go together, as CSS variables. Use one family for the background, one warm accent for what the player taps or wins, and light ink for text. Name them for the game.

```css
:root {
  --sky-top: #0a0f2e;
  --sky-mid: #251a52;
  --horizon: #7a2f63;
  --glow: #ffb547;
  --ember: #e4572e;
  --ink: #fff8ec;
}
```

**A background with a scene.** Never one flat fill. Layer a gradient, a light source and a silhouette, and add texture with a pseudo-element. Repeating tiny radial gradients make stars, bubbles, dust or snow.

```css
.game {
  position: relative;
  background:
    radial-gradient(
      circle at 80% 11%,
      #fff6d8 0 26px,
      #fff6d855 28px,
      transparent 70px
    ),
    linear-gradient(180deg, var(--sky-top), var(--sky-mid) 55%, var(--horizon));
}
.game::before {
  content: "";
  position: absolute;
  inset: 0 0 40% 0;
  background:
    radial-gradient(1.5px 1.5px at 12% 22%, #fff, transparent),
    radial-gradient(1px 1px at 68% 18%, #fff, transparent),
    radial-gradient(2px 2px at 91% 34%, #fff8, transparent);
  background-size: 180px 160px;
  pointer-events: none;
}
.game::after {
  content: "";
  position: absolute;
  inset: auto -20% 0;
  height: 22%;
  background: radial-gradient(60% 100% at 25% 100%, #120c26 98%, transparent);
  pointer-events: none;
}
.hud,
.board {
  position: relative;
  z-index: 1;
}
```

**Depth on every piece.** A solid darker edge underneath, a soft shadow, a light inner rim on top, and a gradient face. Pressed pieces sink.

```css
.tile {
  border: 0;
  border-radius: 16px;
  background: linear-gradient(160deg, #ffe39a, #ffc23d);
  color: #4a2a00;
  box-shadow:
    0 5px 0 #c98a12,
    0 10px 18px #0005,
    inset 0 2px 0 #fff9;
  transition: transform 0.1s;
}
.tile:active {
  transform: translateY(4px);
}
```

**Glow and light.** A lit or selected piece glows through a blurred radial gradient on a pseudo-element. Fade its `opacity`, which is cheap, instead of animating a shadow.

```css
.piece::before {
  content: "";
  position: absolute;
  inset: -25%;
  border-radius: 50%;
  background: radial-gradient(
    closest-side,
    #ffc56ab0,
    #ffb54733 60%,
    transparent
  );
  opacity: 0;
  transition: opacity 0.25s;
}
.piece.on::before {
  opacity: 1;
}
```

**Card flips.** Two faces in one button, turned with `rotateY` and `backface-visibility: hidden`.

```css
.card {
  position: relative;
  aspect-ratio: 1;
  perspective: 600px;
}
.face {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  backface-visibility: hidden;
  transition: transform 0.25s ease-out;
}
.front {
  transform: rotateY(180deg);
}
.card.up .back {
  transform: rotateY(-180deg);
}
.card.up .front {
  transform: rotateY(0deg);
}
```

**Juice on every event.** A pop on a right move, a shake on a wrong one, a banner that rises and fades on a level cleared, a number that throbs when time runs low. Put the animation on a class the state turns on, or on an element keyed by the event (`key={level}`) so it plays again each time.

```css
@keyframes pop {
  50% {
    transform: scale(1.15);
  }
}
@keyframes shake {
  25% {
    transform: translateX(-6px);
  }
  75% {
    transform: translateX(6px);
  }
}
@keyframes rise {
  0% {
    opacity: 0;
    transform: scale(0.6);
  }
  25% {
    opacity: 1;
    transform: scale(1.1);
  }
  100% {
    opacity: 0;
    transform: translateY(-40px);
  }
}
.right {
  animation: pop 0.25s;
}
.wrong {
  animation: shake 0.25s;
}
.banner {
  animation: rise 0.9s ease-out forwards;
}
.paused * {
  animation-play-state: paused !important;
}
```

**Type.** Bold and big (`font: 800 20px system-ui, sans-serif`), headings 28 to 44 px, with a hard shadow so they read on any background (`text-shadow: 0 3px 0 #0007`). Put HUD values in pills (`padding: 8px 16px; border-radius: 999px; background: #0008;`).

**A timer you can see.** A bar that shrinks with `transform: scaleX(share)` and `transform-origin: left`, filled with a gradient, in a dark rounded track, plus the seconds beside it, which turn red and throb in the last few seconds.

**Pictures.** Big emoji with `filter: drop-shadow(0 4px 3px #0005)` (static, never animated). Inline `<svg>` for icons, characters and board pieces, coloured with `fill: var(--accent)`. CSS shapes (rounded rects, gradients, pseudo-elements) for anything simple. The example's lanterns are a `<button>` and one `<span>`.

## Example: Lantern Night

A lights-out puzzle. Tapping a lantern flips it and its four neighbours. Put out every lantern before the candle burns down. Each night cleared scores 1, adds 8 s, and brings a harder board, scrambled from dark by one more tap. After 6 s on a board, one lantern that helps nudges as a hint.

`src/lanterns.ts`:

```ts
const SIZE = 5;
const CELLS = SIZE * SIZE;
const START_MS = 40_000;
const CLEAR_BONUS_MS = 8000;
const MAX_MS = 60_000;
const CLEARED_MS = 900;
const HINT_AFTER_MS = 6000;

export interface Game {
  lit: boolean[];
  // The taps that would put every lantern out. A tap on one of them takes it off the list, on any other adds it, so
  // the hint is always a tap that helps.
  solution: boolean[];
  phase: "playing" | "cleared";
  level: number;
  moves: number;
  timeLeft: number;
  phaseMs: number;
}

const around = (index: number) => {
  const column = index % SIZE;
  return [
    index,
    index - SIZE,
    index + SIZE,
    column > 0 ? index - 1 : -1,
    column < SIZE - 1 ? index + 1 : -1,
  ].filter((cell) => cell >= 0 && cell < CELLS);
};

const press = (lit: boolean[], index: number) => {
  const flipped = around(index);
  return lit.map((on, cell) => (flipped.includes(cell) ? !on : on));
};

// Scrambled from all dark by taps, so the board is always solvable in at most that many taps.
const board = (level: number) => {
  const taps = Math.min(level + 1, 9);
  for (;;) {
    let lit = new Array<boolean>(CELLS).fill(false);
    const solution = new Array<boolean>(CELLS).fill(false);
    let placed = 0;
    while (placed < taps) {
      const cell = Math.floor(Math.random() * CELLS);
      if (!solution[cell]) {
        solution[cell] = true;
        lit = press(lit, cell);
        placed += 1;
      }
    }
    if (lit.some(Boolean)) {
      return { lit, solution };
    }
  }
};

export const newGame = (): Game => ({
  ...board(1),
  level: 1,
  moves: 0,
  phase: "playing",
  phaseMs: 0,
  timeLeft: START_MS,
});

export const tap = (game: Game, index: number): Game => {
  if (game.phase !== "playing" || game.timeLeft === 0) {
    return game;
  }
  const lit = press(game.lit, index);
  const solution = game.solution.map((on, cell) => (cell === index ? !on : on));
  const moves = game.moves + 1;
  if (lit.some(Boolean)) {
    return { ...game, lit, moves, solution };
  }
  return {
    ...game,
    level: game.level + 1,
    lit,
    moves,
    phase: "cleared",
    phaseMs: 0,
    solution,
    timeLeft: Math.min(MAX_MS, game.timeLeft + CLEAR_BONUS_MS),
  };
};

export const tick = (game: Game, ms: number): Game => {
  const phaseMs = game.phaseMs + ms;
  if (game.phase === "cleared") {
    return phaseMs < CLEARED_MS
      ? { ...game, phaseMs }
      : { ...game, ...board(game.level), phase: "playing", phaseMs: 0 };
  }
  return { ...game, phaseMs, timeLeft: Math.max(0, game.timeLeft - ms) };
};

export const hintAt = (game: Game) =>
  game.phase === "playing" && game.phaseMs >= HINT_AFTER_MS
    ? game.solution.indexOf(true)
    : -1;

export const timeShare = (game: Game) => game.timeLeft / MAX_MS;
```

`src/main.tsx`:

```tsx
import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { hintAt, newGame, tap, tick, timeShare } from "./lanterns";
import "./style.css";

hopon.title = "Lantern Night";
hopon.hint = "Tap a lantern: it and its neighbours flip";

const TICK_MS = 100;

let round = 0;
let lastState = hopon.state;
hopon.subscribe(() => {
  if (hopon.state === "play" && lastState !== "play") {
    round += 1;
  }
  lastState = hopon.state;
});

const useHopon = <T,>(read: () => T) =>
  useSyncExternalStore(hopon.subscribe, read);

const Lantern = ({
  on,
  hint,
  onTap,
}: {
  on: boolean;
  hint: boolean;
  onTap: () => void;
}) => (
  <button
    aria-label={on ? "lit lantern" : "dark lantern"}
    className={`lantern${on ? " on" : ""}${hint ? " hint" : ""}`}
    onPointerDown={onTap}
    type="button"
  >
    <span className="shade" />
  </button>
);

const Board = () => {
  const [game, setGame] = useState(newGame);
  const state = useHopon(() => hopon.state);
  const paused = useHopon(() => hopon.paused);
  const score = useHopon(() => hopon.score);
  const running = state === "play" && !paused;

  useEffect(() => {
    if (!running) {
      return;
    }
    const id = setInterval(() => setGame((now) => tick(now, TICK_MS)), TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (game.timeLeft === 0) {
      hopon.gameOver();
    }
  }, [game.timeLeft]);

  const press = (index: number) => {
    if (state !== "play") {
      return;
    }
    const next = tap(game, index);
    if (next.level > game.level) {
      hopon.addScore(1);
    }
    setGame(next);
  };

  const hint = hintAt(game);
  const lit = game.lit.filter(Boolean).length;
  const seconds = Math.ceil(game.timeLeft / 1000);
  Object.assign(hopon.testVars, {
    hint,
    level: game.level,
    lit,
    moves: game.moves,
    timeLeft: game.timeLeft,
  });

  return (
    <main className={`game${paused ? " paused" : ""}`}>
      <header className="hud">
        <span className="pill">Night {game.level}</span>
        <span className="pill">★ {score}</span>
      </header>
      <section className="board">
        <div className="grid">
          {game.lit.map((on, index) => (
            <Lantern
              hint={index === hint}
              key={index}
              on={on}
              onTap={() => press(index)}
            />
          ))}
        </div>
        {game.phase === "cleared" && (
          <div className="banner" key={game.level}>
            All dark!
            <small>+8 s</small>
          </div>
        )}
      </section>
      <footer className={`candle${seconds <= 8 ? " low" : ""}`}>
        <div className="wax-track">
          <div
            className="wax"
            style={{ transform: `scaleX(${timeShare(game)})` }}
          />
        </div>
        <span className="seconds">{seconds} s</span>
      </footer>
    </main>
  );
};

const App = () => {
  useEffect(() => hopon.ready(), []);
  return <Board key={useHopon(() => round)} />;
};

const root = document.querySelector("#root");
if (root) {
  createRoot(root).render(<App />);
}
```

`src/style.css`:

```css
:root {
  --sky-top: #0a0f2e;
  --sky-mid: #251a52;
  --horizon: #7a2f63;
  --hill: #120c26;
  --flame: #fff4c2;
  --glow: #ffb547;
  --ember: #e4572e;
  --unlit: #2b2f5e;
  --ink: #fff8ec;
}

html,
body,
#root {
  margin: 0;
  height: 100%;
}

body {
  background: var(--sky-top);
  overscroll-behavior: none;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
}

.game {
  position: relative;
  overflow: hidden;
  box-sizing: border-box;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 16px 16px 24px;
  color: var(--ink);
  font:
    800 20px system-ui,
    sans-serif;
  background:
    radial-gradient(
      circle at 80% 11%,
      #fff6d8 0 26px,
      #fff6d855 28px,
      transparent 70px
    ),
    linear-gradient(180deg, var(--sky-top), var(--sky-mid) 55%, var(--horizon));
}

.game::before {
  content: "";
  position: absolute;
  inset: 0 0 40% 0;
  background:
    radial-gradient(1.5px 1.5px at 12% 22%, #fff, transparent),
    radial-gradient(1px 1px at 33% 8%, #fffc, transparent),
    radial-gradient(1.5px 1.5px at 52% 30%, #fffa, transparent),
    radial-gradient(1px 1px at 68% 18%, #fff, transparent),
    radial-gradient(2px 2px at 91% 34%, #fff8, transparent),
    radial-gradient(1px 1px at 24% 42%, #fff9, transparent);
  background-size: 180px 160px;
  pointer-events: none;
}

.game::after {
  content: "";
  position: absolute;
  inset: auto -20% 0;
  height: 22%;
  background:
    radial-gradient(60% 100% at 25% 100%, var(--hill) 98%, transparent),
    radial-gradient(70% 80% at 85% 100%, #1b1238 98%, transparent);
  pointer-events: none;
}

.hud,
.board,
.candle {
  position: relative;
  z-index: 1;
}

.hud {
  display: flex;
  justify-content: space-between;
  width: 100%;
  max-width: 420px;
}

.pill {
  padding: 8px 16px;
  border-radius: 999px;
  background: #0008;
  box-shadow: inset 0 1px 0 #fff3;
  text-shadow: 0 2px 0 #0009;
}

.board {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
}

.grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
  width: min(100%, 420px, 60dvh);
}

.lantern {
  position: relative;
  aspect-ratio: 1;
  border: 0;
  padding: 0;
  background: none;
  transition: transform 0.12s;
}

.lantern:active {
  transform: scale(0.9);
}

.lantern::before {
  content: "";
  position: absolute;
  inset: -25%;
  border-radius: 50%;
  background: radial-gradient(
    closest-side,
    #ffc56ab0,
    #ffb54733 60%,
    transparent
  );
  opacity: 0;
  transition: opacity 0.25s;
}

.lantern::after {
  content: "";
  position: absolute;
  top: 4%;
  left: 38%;
  right: 38%;
  height: 10%;
  border-radius: 3px 3px 1px 1px;
  background: #1a1430;
  box-shadow: 0 1px 0 #fff2;
}

.shade {
  position: absolute;
  inset: 13% 12% 6%;
  border-radius: 44% 44% 38% 38%;
  background:
    repeating-linear-gradient(90deg, transparent 0 21%, #0003 21% 25%),
    radial-gradient(circle at 50% 35%, #3d4280, var(--unlit) 70%);
  box-shadow:
    inset 0 -5px 0 #0005,
    inset 0 3px 0 #fff1,
    0 4px 8px #0007;
}

.shade::before {
  content: "";
  position: absolute;
  left: 30%;
  right: 30%;
  bottom: -9%;
  height: 9%;
  border-radius: 1px 1px 4px 4px;
  background: #1a1430;
}

.shade::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background:
    repeating-linear-gradient(90deg, transparent 0 21%, #b2380f44 21% 25%),
    radial-gradient(
      circle at 50% 38%,
      var(--flame),
      var(--glow) 42%,
      var(--ember)
    );
  box-shadow: inset 0 -5px 0 #9d2a0c88;
  opacity: 0;
  transition: opacity 0.25s;
}

.lantern.on::before,
.lantern.on .shade::after {
  opacity: 1;
}

.lantern.hint .shade {
  animation: nudge 0.9s ease-in-out infinite;
}

@keyframes nudge {
  50% {
    transform: translateY(-5px) scale(1.08);
  }
}

.banner {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 44px;
  color: var(--flame);
  text-shadow:
    0 3px 0 #7a2f63,
    0 0 24px var(--glow);
  animation: rise 0.9s ease-out forwards;
  pointer-events: none;
}

.banner small {
  font-size: 22px;
  color: var(--ink);
}

@keyframes rise {
  0% {
    opacity: 0;
    transform: scale(0.6);
  }
  25% {
    opacity: 1;
    transform: scale(1.1);
  }
  100% {
    opacity: 0;
    transform: translateY(-40px);
  }
}

.candle {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  max-width: 420px;
}

.wax-track {
  flex: 1;
  height: 18px;
  border-radius: 9px;
  overflow: hidden;
  background: #0009;
  box-shadow: inset 0 2px 4px #000c;
}

.wax {
  height: 100%;
  transform-origin: left;
  border-radius: 9px;
  background: linear-gradient(90deg, var(--ember), var(--glow), var(--flame));
  transition: transform 0.1s linear;
}

.seconds {
  min-width: 52px;
  text-align: right;
  text-shadow: 0 2px 0 #0009;
}

.candle.low .seconds {
  color: #ff8a6a;
  animation: throb 0.5s ease-in-out infinite alternate;
}

@keyframes throb {
  to {
    transform: scale(1.15);
  }
}

.paused * {
  animation-play-state: paused !important;
}
```

`tests.json`:

```json
{
  "expose": [
    { "name": "lit", "means": "lanterns lit on the board" },
    { "name": "moves", "means": "lanterns tapped this round" },
    { "name": "level", "means": "the night being played, from 1" },
    { "name": "timeLeft", "means": "candle time left, in ms" },
    { "name": "hint", "means": "the lantern the hint nudges, or -1 for none" }
  ],
  "tests": [
    {
      "name": "tapping a lantern flips it and its neighbours",
      "inputs": [{ "at": 200, "type": "tap", "x": 180, "y": 322 }],
      "checks": [
        { "at": 100, "expect": "vars.moves === 0 && vars.lit > 0" },
        {
          "at": 400,
          "expect": "vars.moves === 1 && vars.lit !== prev.vars.lit"
        }
      ]
    },
    {
      "name": "the candle burns down, and stops while the feed has the game paused",
      "inputs": [
        { "at": 600, "type": "pause" },
        { "at": 1800, "type": "resume" }
      ],
      "checks": [
        { "at": 500, "expect": "vars.timeLeft < 40000" },
        { "at": 700, "expect": "vars.timeLeft > 0" },
        { "at": 1700, "expect": "vars.timeLeft === prev.vars.timeLeft" },
        { "at": 2800, "expect": "vars.timeLeft < prev.vars.timeLeft" }
      ]
    },
    {
      "name": "the game ends when the candle burns out",
      "inputs": [],
      "checks": [
        { "at": 38000, "expect": "state === 'play'" },
        { "at": 41000, "expect": "state === 'over' && vars.timeLeft === 0" }
      ]
    }
  ]
}
```

## Checking your work

How a test and a playtest run is in `make-game`. For a React game:

- **Tests read `hopon.testVars`.** Expose what the player sees, such as pieces left, moves, the level, the time left or the question on screen. Write them in the render body.
- **Tap where the pieces are.** The playtest's screen is 360 × 640 CSS px. Work out each piece's centre from the layout, then check it on the first screenshot. A tap in the gap between two pieces hits nothing.
- **A pause test** for every game with a clock. It has a `{"type": "pause"}` input, a check a second later that the time hasn't moved (`vars.timeLeft === prev.vars.timeLeft`), then `{"type": "resume"}` and a check that it moves again. The example's second test is one.
- **Tests read state, not animations.** CSS transitions and keyframes run on real time, while the game runs on the playtest's fake clock. A minute of game time can pass while a 0.3 s flip is still turning. Check `vars`, never wait for an animation. The screenshots wait 0.3 s of real time first, so keep transitions at 0.3 s or less and the screenshots show them finished.
- **React renders on the fake clock.** State set from a tap, a `setTimeout`, a `setInterval` or an animation frame shows up at the next check.
- **Look at both screenshots.** Pieces inside the screen, text readable, the HUD clear of the board, the background a scene. Fix what looks plain before you call it done.
