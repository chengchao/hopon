hopon.title = "Neon Snake";
hopon.hint = "Swipe to turn";

const GW = 18;
const GH = 24;
const eat = new Sound([0.5, 0, 900, 0.01, 0.05, 0.1, 0, 1, 0, 0, 300]);
const crash = new Sound([1, 0.1, 120, 0.02, 0.2, 0.4, 4, 2, -5]);

let snake: Vector2[] = [];
let dir = vec2(1, 0);
let queue: Vector2[] = [];
let food = vec2(0, 0);
let acc = 0;
let eaten = 0;
let swipeStart: Vector2 | undefined;

const cell = (p: Vector2) => vec2(p.x - GW / 2 + 0.5, p.y - GH / 2 + 0.5);

function placeFood() {
  for (let i = 0; i < 500; i++) {
    const p = vec2(randInt(GW), randInt(GH));
    if (!snake.some((s) => s.x === p.x && s.y === p.y)) {
      food = p;
      return;
    }
  }
}

function gameInit() {
  setCameraPos(vec2(0, 0));
  snake = [vec2(9, 12), vec2(8, 12), vec2(7, 12)];
  dir = vec2(1, 0);
  queue = [];
  acc = 0;
  eaten = 0;
  swipeStart = undefined;
  placeFood();
}

function turn(d: Vector2) {
  const last = queue.length ? queue[queue.length - 1] : dir;
  if (d.x === -last.x && d.y === -last.y) return;
  if (d.x === last.x && d.y === last.y) return;
  if (queue.length < 2) queue.push(d);
}

function gameUpdate() {
  setCameraScale(mainCanvasSize.x / 20);
  if (mouseWasPressed(0)) swipeStart = mousePosScreen.copy();
  if (mouseIsDown(0) && swipeStart) {
    const d = mousePosScreen.subtract(swipeStart);
    if (d.length() > 25) {
      turn(
        Math.abs(d.x) > Math.abs(d.y)
          ? vec2(Math.sign(d.x), 0)
          : vec2(0, -Math.sign(d.y))
      );
      swipeStart = mousePosScreen.copy();
    }
  }
  if (mouseWasReleased(0)) swipeStart = undefined;
  if (keyWasPressed("ArrowUp")) turn(vec2(0, 1));
  if (keyWasPressed("ArrowDown")) turn(vec2(0, -1));
  if (keyWasPressed("ArrowLeft")) turn(vec2(-1, 0));
  if (keyWasPressed("ArrowRight")) turn(vec2(1, 0));

  acc += timeDelta;
  const step = Math.max(0.06, 0.16 - Math.floor(eaten / 5) * 0.012);
  if (acc < step) return;
  acc -= step;
  if (queue.length) dir = queue.shift()!;
  const h = snake[0];
  const n = vec2((h.x + dir.x + GW) % GW, (h.y + dir.y + GH) % GH);
  const grow = n.x === food.x && n.y === food.y;
  const body = grow ? snake : snake.slice(0, -1);
  if (body.some((s) => s.x === n.x && s.y === n.y)) {
    crash.play();
    hopon.gameOver();
    return;
  }
  snake.unshift(n);
  if (grow) {
    eaten++;
    hopon.addScore(1);
    eat.play();
    placeFood();
  } else snake.pop();
}

function gameRender() {
  drawRect(cameraPos, vec2(100), BLACK);
  drawRect(vec2(0, 0), vec2(GW + 0.2, GH + 0.2), rgb(0.1, 0.3, 0.15));
  drawRect(vec2(0, 0), vec2(GW, GH), BLACK);
  const pulse = 0.7 + 0.3 * Math.sin(time * 8);
  const fp = cell(food);
  drawCircle(fp, 1.6 * pulse, rgb(1, 0.1, 0.6, 0.25));
  drawCircle(fp, 0.7 * pulse + 0.2, rgb(1, 0.3, 0.7));
  snake.forEach((s, i) => {
    const p = cell(s);
    drawRect(p, vec2(1.3), rgb(0.2, 1, 0.3, 0.2));
    drawRect(p, vec2(0.85), i === 0 ? rgb(0.7, 1, 0.7) : rgb(0.2, 1, 0.3));
  });
}
