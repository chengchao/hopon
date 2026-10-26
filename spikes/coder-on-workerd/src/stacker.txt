hopon.title = "Tower Stack";
hopon.hint = "Tap to drop the block";

const drop = new Sound([0.5, 0, 300, 0.01, 0.05, 0.1, 1, 2]);
const crash = new Sound([1, 0.1, 120, 0.02, 0.2, 0.4, 4, 2, -5]);

type Blk = { x: number; w: number; n: number };
let stack: Blk[] = [];
let cur: Blk;
let dir = 1;
let speed = 0.15;
let camY = 0;
let falling: { x: number; y: number; w: number; n: number; vy: number }[] = [];
let ended = false;

const col = (n: number) => hsl((n * 0.04) % 1, 0.75, 0.55);
const yOf = (n: number) => -9 + n;

function gameInit() {
  setCameraPos(vec2(0, 0));
  stack = [{ x: 0, w: 6, n: 0 }];
  cur = { x: -10, w: 6, n: 1 };
  dir = 1;
  speed = 0.15;
  camY = 0;
  falling = [];
  ended = false;
}

function gameUpdate() {
  setCameraScale(mainCanvasSize.x / 20);
  cur.x += dir * speed;
  if (cur.x > 9) dir = -1;
  if (cur.x < -9) dir = 1;
  if (!(mouseWasPressed(0) || keyWasPressed("Space"))) return;
  const top = stack[stack.length - 1];
  const l = Math.max(cur.x - cur.w / 2, top.x - top.w / 2);
  const r = Math.min(cur.x + cur.w / 2, top.x + top.w / 2);
  if (r <= l) {
    falling.push({ x: cur.x, y: yOf(cur.n), w: cur.w, n: cur.n, vy: 0 });
    ended = true;
    crash.play();
    hopon.gameOver();
    return;
  }
  const w = r - l;
  let cx = (l + r) / 2;
  if (Math.abs(cur.x - top.x) < 0.25) {
    cx = top.x;
  }
  const lo = cur.x - cur.w / 2;
  const hi = cur.x + cur.w / 2;
  if (lo < l)
    falling.push({ x: (lo + l) / 2, y: yOf(cur.n), w: l - lo, n: cur.n, vy: 0 });
  if (hi > r)
    falling.push({ x: (hi + r) / 2, y: yOf(cur.n), w: hi - r, n: cur.n, vy: 0 });
  const nw = Math.abs(cur.x - top.x) < 0.25 ? top.w : w;
  stack.push({ x: cx, w: nw, n: cur.n });
  hopon.addScore(1);
  drop.play();
  speed = Math.min(0.4, speed + 0.006);
  cur = { x: dir > 0 ? -10 : 10, w: nw, n: cur.n + 1 };
}

function gameUpdatePost() {
  const target = Math.max(0, stack.length - 6);
  camY = lerp(camY, target, 0.08);
  setCameraPos(vec2(0, camY));
  for (const f of falling) {
    f.vy -= 0.01;
    f.y += f.vy;
  }
  falling = falling.filter((f) => f.y > camY - 20);
}

function gameRender() {
  drawRectGradient(cameraPos, vec2(100, 100), hsl(0.6, 0.8, 0.45), hsl(0.95, 0.7, 0.8));
  for (const b of stack)
    drawRect(vec2(b.x, yOf(b.n)), vec2(b.w, 0.96), col(b.n));
  for (const f of falling) drawRect(vec2(f.x, f.y), vec2(f.w, 0.96), col(f.n));
  if (!ended) drawRect(vec2(cur.x, yOf(cur.n)), vec2(cur.w, 0.96), col(cur.n));
  drawRect(vec2(0, yOf(0) - 20.5), vec2(60, 40), hsl(0.3, 0.4, 0.25));
}
