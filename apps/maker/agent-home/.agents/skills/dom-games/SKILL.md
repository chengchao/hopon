---
name: dom-games
description: How to write a hopon game with plain DOM (cards, quizzes, word games, trivia, tile puzzles) as index.html plus game.ts. Load before writing or changing a plain-DOM game.
---

# Writing a plain-DOM hopon game

A plain-DOM game is two files in the workspace:

- `index.html`: the whole page: markup and a `<style>`. It must load the scaffold and the game, in this order, at the end of `<body>`:
  ```html
  <script src="/dom.js"></script>
  <script src="game.js"></script>
  ```
  The playtest emits `game.js` from `game.ts`. No other scripts, no inline `<script>`, no `onclick=` attributes: the page's CSP allows only scripts from its own origin.
- `game.ts`: the logic, a classic script typed against the browser's DOM. No `import`, no `export`.

Nothing else loads: no images, fonts or files from the web, no `fetch`, no `localStorage`. Draw with CSS, emoji and inline SVG.

## The page

- Portrait phone, at least 360×640 CSS px, often taller. `<meta name="viewport" content="width=device-width,initial-scale=1">`, `body { margin: 0; touch-action: manipulation; }`, and size things with `vw`, `vh`, flex and grid so nothing overflows.
- Big tap targets (at least 48 px), big readable text (at least 18 px), strong contrast.
- Handle `click` (taps arrive as clicks). Use `addEventListener` in `game.ts`.
- Show the score and the end yourself: there is no scaffold overlay. A start screen is optional; the playtest taps the centre once before its inputs, so a centred "Start" button is fine.

## The hopon scaffold (`/dom.js`)

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
        background: #1b1f3b;
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
        font-weight: 700;
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
    <script src="/dom.js"></script>
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
