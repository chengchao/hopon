-- A hopon original on the served runtime (/runtime/v1.js): LittleJS and the scaffold, with the game inline until
-- Games are files (#145). It shows the runtime loading under GAME_CSP in the feed, and the feed's pause and mute.
INSERT INTO games(owner, title, description, html, published, author) VALUES('hopon','Bubble Pop','Pop the bubbles before they float away. Let three escape and it''s over.','<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bubble Pop</title><style>html,body{margin:0;background:#000;overflow:hidden;touch-action:none}</style></head><body><script src="/runtime/v1.js"></script><script>
hopon.title = "Bubble Pop";
hopon.hint = "Pop them before they float away";
const pop = new Sound([0.5, 0, 900, 0.01, 0.05, 0.1, 0, 1, 0, 0, 300]);
const miss = new Sound([1, 0.1, 120, 0.02, 0.2, 0.4, 4, 2, -5]);
let bubbles = [];
let lives = 3;
let next = 0;
function gameInit() {
  bubbles = [];
  lives = 3;
  next = time;
}
function gameUpdate() {
  const half = mainCanvasSize.scale(0.5 / cameraScale);
  if (time > next) {
    next = time + Math.max(0.35, 0.9 - hopon.score * 0.02);
    bubbles.push({ hue: rand(), pos: vec2(rand(1 - half.x, half.x - 1), -half.y - 1), r: rand(0.7, 1.3), speed: rand(2, 3.5) + hopon.score * 0.06 });
  }
  if (mouseWasPressed(0)) {
    const hit = bubbles.find((b) => b.pos.distance(mousePos) < b.r + 0.4);
    if (hit) {
      bubbles = bubbles.filter((b) => b !== hit);
      pop.play(hit.pos);
      hopon.addScore();
    }
  }
  for (const b of bubbles) {
    b.pos.y += b.speed * timeDelta;
  }
  const escaped = bubbles.filter((b) => b.pos.y > half.y + b.r);
  if (escaped.length > 0) {
    bubbles = bubbles.filter((b) => !escaped.includes(b));
    miss.play();
    lives -= escaped.length;
    if (lives <= 0) {
      hopon.gameOver();
    }
  }
}
function gameRender() {
  drawRect(cameraPos, vec2(100), hsl(0.6, 0.5, 0.15));
  for (const b of bubbles) {
    drawCircle(b.pos, b.r * 2, hsl(b.hue, 0.7, 0.6, 0.85), 0.1, WHITE);
  }
}
function gameRenderPost() {
  if (hopon.state === "play") {
    drawTextScreen("\u2665".repeat(Math.max(lives, 0)), vec2(mainCanvasSize.x - 14, 26), 28, RED, 4, BLACK, "right");
  }
}
</script></body></html>',1,'hopon');
