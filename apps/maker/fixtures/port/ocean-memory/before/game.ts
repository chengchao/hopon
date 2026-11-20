const EMOJI = ["🐟", "🐙", "🦀", "🐋", "🐢", "🦈", "🪼", "🐴"];
const gridEl = document.getElementById("grid")!;
const infoEl = document.getElementById("info")!;
const msgEl = document.getElementById("msg")!;
const againEl = document.getElementById("again")!;
let moves = 0;
let found = 0;
let first: HTMLButtonElement | null = null;
let locked = false;
const testVars: Record<string, number | string | boolean> = {};

function expose() {
  testVars.moves = moves;
  testVars.found = found;
  testVars.faceUp = gridEl.querySelectorAll(".card.up:not(.done)").length;
}

function build() {
  const deck = [...EMOJI, ...EMOJI].sort(() => Math.random() - 0.5);
  gridEl.replaceChildren(
    ...deck.map((e) => {
      const b = document.createElement("button");
      b.className = "card";
      b.dataset.e = e;
      b.textContent = "🐚";
      b.addEventListener("click", () => flip(b));
      return b;
    })
  );
  expose();
}

function show(b: HTMLButtonElement, up: boolean) {
  b.classList.toggle("up", up);
  b.textContent = up ? b.dataset.e! : "🐚";
}

function flip(b: HTMLButtonElement) {
  if (locked || b === first || b.classList.contains("done")) return;
  show(b, true);
  if (!first) {
    first = b;
    expose();
    return;
  }
  const a = first;
  first = null;
  moves++;
  infoEl.textContent = "Moves " + moves;
  if (a.dataset.e === b.dataset.e) {
    a.classList.add("done");
    b.classList.add("done");
    hopon.addScore(1);
    found++;
    if (found === EMOJI.length) {
      msgEl.textContent = `You won in ${moves} moves! 🎉`;
      againEl.style.display = "block";
      hopon.gameOver(true);
    }
  } else {
    locked = true;
    setTimeout(() => {
      show(a, false);
      show(b, false);
      locked = false;
      expose();
    }, 800);
  }
  expose();
}

againEl.addEventListener("click", () => {
  hopon.restart();
  moves = 0;
  found = 0;
  first = null;
  locked = false;
  infoEl.textContent = "Moves 0";
  msgEl.textContent = "";
  againEl.style.display = "none";
  build();
});

build();
