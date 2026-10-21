hopon.title = "Balloon Float";
hopon.hint = "Tap to puff up";

const puff = new Sound([0.5, 0, 500, 0.01, 0.05, 0.1, 1, 2, 10]);
const crash = new Sound([1, 0.1, 120, 0.02, 0.2, 0.4, 4, 2, -5]);
const point = new Sound([0.5, 0, 900, 0.01, 0.05, 0.1, 0, 1, 0, 0, 300]);

const BX = -4;
const GROUND = -11.5;
const PW = 3;
let by = 0;
let vy = 0;
let pillars: { x: number; gap: number; h: number; done: boolean }[] = [];
let nextX = 0;

function gameInit() {
  setCameraPos(vec2(0, 0));
  by = 0;
  vy = 0;
  pillars = [];
  nextX = 12;
}

function die() {
  crash.play();
  new ParticleEmitter(vec2(BX, by), 0, 0.5, 0.2, 60, 3.14, undefined, ORANGE, RED);
  hopon.gameOver();
}

function gameUpdate() {
  setCameraScale(mainCanvasSize.x / 20);
  const dt = timeDelta * 60;
  if (mouseWasPressed(0) || keyWasPressed("Space")) {
    vy = 0.22;
    puff.play();
  }
  vy -= 0.01 * dt;
  vy = Math.max(vy, -0.3);
  by += vy * dt;
  const speed = (0.07 + Math.min(hopon.score, 30) * 0.002) * dt;
  for (const p of pillars) p.x -= speed;
  nextX -= speed;
  if (nextX <= 12) {
    const h = Math.max(3.4, 4.8 - hopon.score * 0.05);
    pillars.push({ x: 12 + PW, gap: rand(-5, 5), h, done: false });
    nextX = 12 + 8.5;
  }
  pillars = pillars.filter((p) => p.x > -13);
  for (const p of pillars) {
    if (!p.done && p.x < BX) {
      p.done = true;
      hopon.addScore(1);
      point.play();
    }
    if (Math.abs(p.x - BX) < PW / 2 + 0.7) {
      if (by + 0.9 > p.gap + p.h / 2 || by - 0.9 < p.gap - p.h / 2) {
        if (Math.abs(p.x - BX) < PW / 2 + 0.7 - 0.15) return die();
      }
    }
  }
  if (by - 1 < GROUND || by > 14) die();
}

function gameRender() {
  drawRectGradient(cameraPos, vec2(100, 100), hsl(0.58, 0.7, 0.6), hsl(0.55, 0.6, 0.88));
  for (let i = 0; i < 4; i++) {
    const cx = (((i * 9 - time * 0.8) % 36) + 36) % 36 - 18;
    drawEllipse(vec2(cx, 8 - i * 2.5), vec2(4, 1.2), rgb(1, 1, 1, 0.7));
  }
  const rock = hsl(0.07, 0.8, 0.45);
  const dark = hsl(0.05, 0.8, 0.33);
  for (const p of pillars) {
    const top = p.gap + p.h / 2;
    const bot = p.gap - p.h / 2;
    drawRect(vec2(p.x, top + 15), vec2(PW, 30), rock);
    drawRect(vec2(p.x, bot - 15), vec2(PW, 30), rock);
    drawRect(vec2(p.x, top + 0.3), vec2(PW + 0.4, 0.6), dark);
    drawRect(vec2(p.x, bot - 0.3), vec2(PW + 0.4, 0.6), dark);
  }
  drawRect(vec2(0, GROUND - 5), vec2(30, 10), hsl(0.07, 0.85, 0.4));
  drawRect(vec2(0, GROUND - 0.2), vec2(30, 0.4), dark);
  // balloon
  const c = vec2(BX, by + 0.4);
  drawCircle(c, 2, ORANGE);
  drawEllipse(c, vec2(0.9, 2), WHITE);
  drawEllipse(c, vec2(0.3, 2), RED);
  drawCircle(c, 2, rgb(0, 0, 0, 0), 0.08, hsl(0.05, 0.8, 0.3));
  drawLine(vec2(BX - 0.5, by - 0.5), vec2(BX - 0.3, by - 0.9), 0.06, BLACK);
  drawLine(vec2(BX + 0.5, by - 0.5), vec2(BX + 0.3, by - 0.9), 0.06, BLACK);
  drawRect(vec2(BX, by - 1.1), vec2(0.8, 0.5), hsl(0.08, 0.6, 0.3));
}
