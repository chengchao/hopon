hopon.title = "Candy Breaker";
hopon.hint = "Drag to move the paddle";

const COLS = 8, ROWS = 6, BW = 2.2, BH = 0.9;
const pop = new Sound([0.5, 0, 900, 0.01, 0.05, 0.1, 0, 1, 0, 0, 300]);
const bounce = new Sound([0.4, 0, 400, 0.01, 0.03, 0.05, 1]);
const lose = new Sound([1, 0.1, 120, 0.02, 0.2, 0.4, 4, 2, -5]);

let bricks: boolean[] = [];
let px = 0, lives = 3, left = 0;
let bp = vec2(0, -9), bv = vec2(0, 0), held = true;
const PW = 4, PY = -11;
const brickPos = (i: number) =>
  vec2(((i % COLS) - (COLS - 1) / 2) * (BW + 0.2), 9 - Math.floor(i / COLS) * (BH + 0.2));

function gameInit() {
  setCameraPos(vec2(0, 0));
  bricks = Array.from({ length: COLS * ROWS }, () => true);
  left = COLS * ROWS; lives = 3; px = 0; held = true;
  bp = vec2(0, PY + 0.7); bv = vec2(0, 0);
}

function gameUpdate() {
  setCameraScale(mainCanvasSize.x / 20);
  if (mouseIsDown(0)) px = lerp(px, mousePos.x, 0.5);
  px += (keyIsDown("ArrowRight") ? 0.3 : 0) - (keyIsDown("ArrowLeft") ? 0.3 : 0);
  px = clamp(px, -10 + PW / 2, 10 - PW / 2);
  if (held) {
    bp = vec2(px, PY + 0.7);
    if (mouseWasReleased(0) || keyWasPressed("Space") || time > 0) {
      if (mouseIsDown(0) || keyWasPressed("Space") || mouseWasReleased(0) || heldTimer++ > 40) {
        held = false; bv = vec2(rand(-0.06, 0.06), 0.2);
      }
    }
    return;
  }
  const steps = 3;
  for (let s = 0; s < steps; s++) {
    bp = bp.add(bv.scale(1 / steps));
    if (bp.x < -9.7) { bp.x = -9.7; bv.x = Math.abs(bv.x); }
    if (bp.x > 9.7) { bp.x = 9.7; bv.x = -Math.abs(bv.x); }
    if (bp.y > 12.5) { bp.y = 12.5; bv.y = -Math.abs(bv.y); }
    if (bv.y < 0 && bp.y < PY + 1 && bp.y > PY - 0.2 && Math.abs(bp.x - px) < PW / 2 + 0.3) {
      const off = (bp.x - px) / (PW / 2);
      const sp = Math.min(0.32, bv.length() + 0.006);
      bv = vec2(off * 0.6, 1).normalize(sp);
      bp.y = PY + 1;
      bounce.play();
    }
    for (let i = 0; i < bricks.length; i++) {
      if (!bricks[i]) continue;
      const c = brickPos(i);
      if (Math.abs(bp.x - c.x) < BW / 2 + 0.3 && Math.abs(bp.y - c.y) < BH / 2 + 0.3) {
        bricks[i] = false; left--;
        const dx = (Math.abs(bp.x - c.x) - BW / 2) , dy = (Math.abs(bp.y - c.y) - BH / 2);
        if (dx > dy) bv.x = -bv.x; else bv.y = -bv.y;
        hopon.addScore(1); pop.play();
        new ParticleEmitter(c, 0, 1, 0.1, 20, Math.PI, undefined, WHITE, YELLOW);
        break;
      }
    }
  }
  if (left <= 0) { hopon.gameOver(true); return; }
  if (bp.y < -13) {
    lives--; lose.play();
    if (lives <= 0) { hopon.gameOver(); return; }
    held = true; heldTimer = 0;
  }
}
let heldTimer = 0;

function gameRender() {
  drawRect(cameraPos, vec2(100), hsl(0.92, 0.7, 0.8));
  for (let i = 0; i < bricks.length; i++) {
    if (!bricks[i]) continue;
    const r = Math.floor(i / COLS);
    drawRect(brickPos(i), vec2(BW, BH), hsl(r / ROWS, 0.9, 0.55));
    drawRect(brickPos(i).add(vec2(0, 0.25)), vec2(BW - 0.2, 0.2), hsl(r / ROWS, 0.9, 0.75));
  }
  drawRect(vec2(px, PY), vec2(PW, 0.7), WHITE);
  drawRect(vec2(px, PY), vec2(PW - 0.4, 0.35), hsl(0.55, 0.8, 0.6));
  drawCircle(bp, 0.6, WHITE, 0.08, hsl(0.9, 0.5, 0.6));
}

function gameRenderPost() {
  drawTextScreen("Lives: " + lives, vec2(mainCanvasSize.x - 15, 25), 22, WHITE, 3, hsl(0.9, 0.6, 0.4), "right");
}
