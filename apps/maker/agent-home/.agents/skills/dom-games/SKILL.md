---
name: dom-games
description: How to write a hopon game with plain DOM (cards, quizzes, word games, trivia, tile puzzles) as index.html plus game.ts. Load before writing or changing a plain-DOM game.
---

# Writing a plain-DOM hopon game

A plain-DOM game is two files in the workspace:

- `index.html`: the whole page: markup and a `<style>`. It must load the scaffold and the game, in this order, at the end of `<body>`:
  ```html
  <script src="/dom/v1.js"></script>
  <script src="game.js"></script>
  ```
  The playtest emits `game.js` from `game.ts`. No other scripts, no inline `<script>`, no `onclick=` attributes: the page's CSP allows only scripts from its own origin.
- `game.ts`: the logic, a classic script typed against the browser's DOM. No `import`, no `export`.

Nothing else loads: no images, fonts or files from the web, no `fetch`, no `localStorage`. Draw with CSS, emoji and inline SVG.

## The page

- Portrait phone, at least 360×640 CSS px, often taller. `<meta name="viewport" content="width=device-width,initial-scale=1">`, `body { margin: 0; touch-action: manipulation; }`, and size things with `vw`, `vh`, flex and grid so nothing overflows.
- Big tap targets (at least 48 px), big readable text (at least 18 px), strong contrast.
- Handle `click` (taps arrive as clicks). Use `addEventListener` in `game.ts`.
- Hidden means hidden: something "down", "off" or not yet revealed gets `display: none` or `visibility: hidden`, or sits inside a container with `overflow: hidden`; never leave it drawn in another element's space.
- A tap area is at least as big as what it looks like, and bigger for small kids' games; never shrink it when the drawing grows.
- Size emoji and text in `vw` or `rem` so they stay big in large grids (at least 24 px for game pieces).
- Show the score and the end yourself: there is no scaffold overlay. A start screen is optional; the playtest taps the centre once before its inputs, so a centred "Start" button is fine.

## Make it look good

The game should look finished, not like a form. Spend about a third of `index.html` on looks.

- **Palette**: 4–6 colours that go together (one hue family plus one accent) as CSS variables on `:root`.
- **Background**: never one flat colour: `background: radial-gradient(circle at 30% 20%, #ffffff33, transparent 40%), linear-gradient(160deg, #3a1c71, #d76d77 60%, #ffaf7b);`.
- **Depth**: cards and buttons with `border-radius: 16px`, a solid "3D" bottom edge plus a soft shadow (`box-shadow: 0 5px 0 #0003, 0 10px 20px #0002`), an inner highlight (`inset 0 2px 0 #fff6`); pressed: `:active { transform: translateY(3px); box-shadow: 0 2px 0 #0003; }`.
- **Emoji and SVG**: big emoji with `filter: drop-shadow(0 4px 3px #0004)`; inline `<svg>` for icons, characters and board pieces, styled with CSS (`fill: var(--accent)`).
- **Type**: bold and big (`font: 800 28px system-ui`), titles with `text-shadow: 0 3px 0 #0003`.
- **Motion**: `transition: transform 0.15s, background 0.2s` on everything tappable; a pop on a right answer and a shake on a wrong one with `@keyframes`, added and removed as classes; card flips with `transform: rotateY(180deg)` and `backface-visibility: hidden`.

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
.pop {
  animation: pop 0.25s;
}
.shake {
  animation: shake 0.25s;
}
```

## The hopon scaffold (`/dom/v1.js`)

```ts
hopon.addScore(1); // add points while playing
hopon.gameOver(); // lose; hopon.gameOver(true) to win
hopon.restart(); // call when the player starts again (score back to 0)
hopon.score;
hopon.best;
hopon.state; // "play" | "over"
```

Call `hopon.gameOver` when the game ends and `hopon.restart` on "Play again". The playtest reads these.

## Example: quiz

`index.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 16px;
        background: linear-gradient(160deg, #1b1f3b, #4b2c6f);
        color: #fff;
        font:
          20px system-ui,
          sans-serif;
        touch-action: manipulation;
      }
      #question {
        padding: 0 24px;
        text-align: center;
        font-size: 26px;
      }
      #answers {
        display: grid;
        gap: 12px;
        width: 86vw;
      }
      button {
        min-height: 56px;
        border: 0;
        border-radius: 14px;
        background: #ffd23f;
        color: #1b1f3b;
        font: inherit;
        font-weight: 800;
        box-shadow:
          0 5px 0 #0004,
          inset 0 2px 0 #fff8;
        transition: transform 0.1s;
      }
      button:active {
        transform: translateY(3px);
      }
      button.wrong {
        background: #ef476f;
        color: #fff;
      }
      button.right {
        background: #06d6a0;
      }
    </style>
  </head>
  <body>
    <div id="score">Score 0</div>
    <div id="question"></div>
    <div id="answers"></div>
    <script src="/dom/v1.js"></script>
    <script src="game.js"></script>
  </body>
</html>
```

`game.ts`:

```ts
const QUESTIONS: { q: string; answers: string[]; right: number }[] = [
  { q: "Which planet is red?", answers: ["Venus", "Mars", "Saturn"], right: 1 },
  { q: "How many legs has a spider?", answers: ["6", "8", "10"], right: 1 },
  { q: "What do bees make?", answers: ["Milk", "Silk", "Honey"], right: 2 },
];
const scoreEl = document.getElementById("score")!;
const questionEl = document.getElementById("question")!;
const answersEl = document.getElementById("answers")!;
let index = 0;

function show() {
  if (index >= QUESTIONS.length) {
    hopon.gameOver(hopon.score === QUESTIONS.length);
    questionEl.textContent = `Done! ${hopon.score} / ${QUESTIONS.length}`;
    answersEl.replaceChildren(
      button("Play again", () => {
        hopon.restart();
        index = 0;
        update();
        show();
      })
    );
    return;
  }
  const { q, answers, right } = QUESTIONS[index];
  questionEl.textContent = q;
  answersEl.replaceChildren(
    ...answers.map((text, i) =>
      button(text, (event) => {
        const target = event.currentTarget as HTMLButtonElement;
        target.classList.add(i === right ? "right" : "wrong");
        if (i === right) hopon.addScore(1);
        update();
        index += 1;
        setTimeout(show, 600);
      })
    )
  );
}

function button(text: string, onClick: (event: MouseEvent) => void) {
  const element = document.createElement("button");
  element.textContent = text;
  element.addEventListener("click", onClick);
  return element;
}

function update() {
  scoreEl.textContent = `Score ${hopon.score}`;
}

show();
```

## Checking your work

Call `playtest` with taps on your buttons or cards (CSS px, the page is 360×640). Check both screenshots: something must change between them, and everything must fit on the screen.
