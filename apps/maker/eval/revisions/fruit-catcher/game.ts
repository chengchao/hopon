hopon.title = "Fruit Catcher";
hopon.hint = "Drag to move the basket";

const W = 20;
const pop = new Sound([0.5, 0, 900, 0.01, 0.05, 0.1, 0, 1, 0, 0, 300]);
const boom = new Sound([1, 0.1, 120, 0.02, 0.2, 0.4, 4, 2, -5]);

type Item = { x: number; y: number; v: number; bomb: boolean };
let items: Item[] = [];
let bx = 0;
let spawnT = 0;
const BY = -11;

function gameInit() {
  setCameraPos(vec2(0, 0));
  items = [];
  bx = 0;
  spawnT = 1;
}

function gameUpdate() {
  setCameraScale(mainCanvasSize.x / W);
  if (mouseIsDown(0)) bx = lerp(bx, mousePos.x, 0.5);
  bx += (keyIsDown("ArrowRight") ? 0.4 : 0) - (keyIsDown("ArrowLeft") ? 0.4 : 0);
  bx = clamp(bx, -W / 2 + 1.8, W / 2 - 1.8);
  const s = hopon.score;
  spawnT -= 1 / 60;
  if (spawnT <= 0) {
    spawnT = Math.max(0.3, 0.9 - s * 0.02);
    const n = 1 + (s > 15 && randBool(0.4) ? 1 : 0) + (s > 35 && randBool(0.4) ? 1 : 0);
    for (let i = 0; i < n; i++)
      items.push({
        x: rand(-W / 2 + 1, W / 2 - 1),
        y: 14 + i * 2,
        v: 0.1 + rand(0, 0.04) + Math.min(0.2, s * 0.004),
        bomb: randBool(Math.min(0.4, 0.2 + s * 0.005)),
      });
  }
  for (const it of items) {
    it.y -= it.v;
    if (it.y < BY + 1.2 && it.y > BY - 0.5 && Math.abs(it.x - bx) < 2.1) {
      it.y = -99;
      if (it.bomb) {
        boom.play();
        new ParticleEmitter(vec2(bx, BY), 0, 1, 0.3, 80, 3.14, undefined, YELLOW, RED);
        hopon.gameOver();
      } else {
        hopon.addScore(1);
        pop.play();
      }
    }
  }
  items = items.filter((i) => i.y > -15);
}

function gameRender() {
  drawRectGradient(cameraPos, vec2(100), hsl(0.56, 0.8, 0.65), hsl(0.55, 0.7, 0.85));
  drawRect(vec2(0, -14), vec2(30, 3.4), hsl(0.28, 0.6, 0.35));
  drawRect(vec2(0, -12.6), vec2(30, 0.6), hsl(0.28, 0.7, 0.5));
  for (const it of items) {
    const p = vec2(it.x, it.y);
    if (it.bomb) {
      drawRect(p, vec2(1.6), BLACK);
      drawRect(p.add(vec2(-0.4, 0.4)), vec2(0.4), GRAY);
      drawRect(p.add(vec2(0.2, 1)), vec2(0.4, 0.5), rgb(0.4, 0.3, 0.2));
      drawRect(p.add(vec2(0.6, 1.4)), vec2(0.5), time % 0.2 < 0.1 ? YELLOW : ORANGE);
    } else {
      drawRect(p, vec2(1.6), RED);
      drawRect(p.add(vec2(-0.4, 0.4)), vec2(0.4), rgb(1, 0.6, 0.6));
      drawRect(p.add(vec2(0, 1)), vec2(0.3, 0.5), rgb(0.4, 0.25, 0.1));
      drawRect(p.add(vec2(0.5, 1)), vec2(0.7, 0.35), GREEN);
    }
  }
  const b = vec2(bx, BY);
  drawRect(b, vec2(4, 1.6), rgb(0.7, 0.45, 0.2));
  drawRect(b.add(vec2(0, 0.9)), vec2(4.4, 0.4), rgb(0.5, 0.3, 0.1));
  drawRect(b.add(vec2(-1, -0.2)), vec2(0.3, 1.2), rgb(0.5, 0.3, 0.1));
  drawRect(b.add(vec2(1, -0.2)), vec2(0.3, 1.2), rgb(0.5, 0.3, 0.1));
}
