hopon.title = "Gnome Whack";
hopon.hint = "Tap the gnomes!";

const bonk = new Sound([0.5, 0, 900, 0.01, 0.05, 0.1, 0, 1, 0, 0, 300]);
const SP = 5.5;
let up: number[] = [];
let life: number[] = [];
let hit: boolean[] = [];
let nextPop = 0;
let t0 = 0;
let t = 30;

const holePos = (i: number) => vec2(((i % 3) - 1) * SP, (1 - Math.floor(i / 3)) * SP - 1);

function gameInit() {
  setCameraPos(vec2(0, 0));
  up = Array(9).fill(0);
  life = Array(9).fill(0);
  hit = Array(9).fill(false);
  nextPop = 0.5;
  t0 = time;
  t = 30;
}

function gameUpdate() {
  setCameraScale(mainCanvasSize.x / 20);
  const el = time - t0;
  t = 30 - el;
  if (t <= 0) {
    t = 0;
    hopon.gameOver();
    return;
  }
  if (el > nextPop) {
    nextPop = el + rand(0.3, 0.7);
    const free = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((i) => life[i] <= 0);
    if (free.length) {
      const i = free[randInt(free.length)];
      life[i] = rand(0.8, 1.2);
      up[i] = 0;
      hit[i] = false;
    }
  }
  for (let i = 0; i < 9; i++) {
    if (life[i] > 0) {
      life[i] -= timeDelta;
      up[i] = Math.min(1, up[i] + timeDelta * 8);
      if (hit[i]) life[i] = Math.min(life[i], 0.15);
    }
  }
  if (mouseWasPressed(0)) {
    for (let i = 0; i < 9; i++) {
      if (life[i] > 0 && !hit[i] && isOverlapping(mousePos, vec2(0), holePos(i).add(vec2(0, 0.8)), vec2(4.6, 5))) {
        hit[i] = true;
        hopon.addScore(1);
        bonk.play();
      }
    }
  }
}

function gameRender() {
  drawRect(cameraPos, vec2(100), hsl(0.3, 0.6, 0.35));
  for (let i = 0; i < 9; i++) {
    const p = holePos(i);
    drawEllipse(p, vec2(4, 1.8), hsl(0.08, 0.5, 0.15));
    const h = life[i] > 0 ? up[i] : 0;
    if (h > 0) {
      const g = p.add(vec2(0, -0.2 + h * 1.4));
      const f = hit[i];
      drawRect(g.add(vec2(0, -0.6)), vec2(2.2, 1.6), hsl(0.6, 0.6, 0.45));
      drawCircle(g.add(vec2(0, 0.6)), 1.8, hsl(0.07, 0.6, 0.8));
      drawPoly([vec2(-1, 0), vec2(1, 0), vec2(0, 2.8)], hsl(0, 0.9, 0.45), 0, undefined, g.add(vec2(0, 1.2)));
      drawRect(g.add(vec2(0, 0.1)), vec2(1.7, 0.7), WHITE);
      drawCircle(g.add(vec2(-0.4, 0.8)), 0.25, f ? RED : BLACK);
      drawCircle(g.add(vec2(0.4, 0.8)), 0.25, f ? RED : BLACK);
    }
    // front lip of hole hides gnome base
    drawRect(p.add(vec2(0, -1.4)), vec2(4.4, 1.2), hsl(0.3, 0.6, 0.35));
    drawEllipse(p.add(vec2(0, -0.9)), vec2(4, 1), hsl(0.08, 0.5, 0.15));
  }
}

function gameRenderPost() {
  drawTextScreen(`${Math.ceil(t)}s`, vec2(mainCanvasSize.x / 2, 30), 32, WHITE, 4, BLACK);
}
