hopon.title = "Gnome Whack";
hopon.hint = "Tap gnomes before they duck! 30s";
const hitS = new Sound([0.5, 0, 900, 0.01, 0.05, 0.1, 0, 1, 0, 0, 300]);
const missS = new Sound([0.4, 0.1, 150, 0.01, 0.1, 0.2, 4, 1, -3]);
const COLS = 3;
const ROWS = 4;
let up: number[] = [];
let life: number[] = [];
let pop: number[] = [];
let whack: number[] = [];
let left = 30;
let nextSpawn = 0;
const hc = (i: number) =>
  vec2(((i % COLS) - 1) * 6, (Math.floor(i / COLS) - 1.5) * 5.5 - 0.5);
function gameInit() {
  setCameraPos(vec2(0, 0));
  const n = COLS * ROWS;
  up = Array(n).fill(0);
  life = Array(n).fill(0);
  pop = Array(n).fill(0);
  whack = Array(n).fill(0);
  left = 30;
  nextSpawn = 0.5;
}
function gameUpdate() {
  setCameraScale(mainCanvasSize.x / 20);
  left -= timeDelta;
  if (left <= 0) {
    left = 0;
    hopon.gameOver();
    return;
  }
  const el = 30 - left;
  nextSpawn -= timeDelta;
  if (nextSpawn <= 0) {
    nextSpawn = Math.max(0.3, 0.8 - el * 0.015);
    const f = up.map((u, i) => (u ? -1 : i)).filter((i) => i >= 0);
    if (f.length) {
      const i = f[randInt(f.length)];
      up[i] = 1;
      life[i] = Math.max(0.6, 1.4 - el * 0.025) + rand(0, 0.3);
    }
  }
  for (let i = 0; i < up.length; i++) {
    if (up[i]) {
      life[i] -= timeDelta;
      pop[i] = Math.min(1, pop[i] + timeDelta * 8);
      if (life[i] <= 0) {
        up[i] = 0;
      }
    } else {
      pop[i] = Math.max(0, pop[i] - timeDelta * 8);
    }
    if (whack[i] > 0) {
      whack[i] -= timeDelta;
    }
  }
  if (mouseWasPressed(0)) {
    for (let i = 0; i < up.length; i++) {
      if (
        up[i] &&
        pop[i] > 0.4 &&
        isOverlapping(mousePos, vec2(0), hc(i).add(vec2(0, 1)), vec2(4.6, 4.6))
      ) {
        up[i] = 0;
        whack[i] = 0.25;
        hopon.addScore(1);
        hitS.play();
        new ParticleEmitter(
          hc(i).add(vec2(0, 1.5)),
          0,
          1,
          0.1,
          30,
          3.14,
          undefined,
          YELLOW,
          ORANGE
        );
        return;
      }
    }
    missS.play();
  }
}
function gameRender() {
  drawRectGradient(
    cameraPos,
    vec2(100),
    hsl(0.55, 0.6, 0.75),
    hsl(0.3, 0.6, 0.5)
  );
  for (let i = 0; i < up.length; i++) {
    const p = hc(i);
    drawEllipse(p, vec2(4.4, 1.6), hsl(0.08, 0.5, 0.15));
    const h = pop[i];
    if (h > 0) {
      const g = p.add(vec2(0, -0.2 + h * 1.8));
      drawRect(g.add(vec2(0, -0.3)), vec2(2, 2), hsl(0.6, 0.7, 0.45));
      drawCircle(g.add(vec2(0, 0.9)), 1.7, hsl(0.07, 0.5, 0.8));
      drawRect(g.add(vec2(0, 0.2)), vec2(1.6, 1.1), WHITE);
      drawPoly(
        [vec2(-1, 1.6), vec2(1, 1.6), vec2(0, 3.9)],
        RED,
        0,
        undefined,
        g
      );
      drawCircle(g.add(vec2(-0.4, 1)), 0.25, BLACK);
      drawCircle(g.add(vec2(0.4, 1)), 0.25, BLACK);
      if (whack[i] > 0) {
        drawText("BONK", g.add(vec2(0, 3)), 1, YELLOW, 0.1, BLACK);
      }
    }
    drawEllipse(p.add(vec2(0, -0.5)), vec2(4.6, 1.4), hsl(0.08, 0.5, 0.25));
  }
}
function gameRenderPost() {
  drawTextScreen(
    `⏱ ${Math.ceil(left)}`,
    vec2(mainCanvasSize.x - 60, 30),
    28,
    left < 6 ? RED : WHITE,
    3,
    BLACK
  );
}
