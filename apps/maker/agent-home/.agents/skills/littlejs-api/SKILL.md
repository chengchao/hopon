---
name: littlejs-api
description: How to write a hopon game in game.ts with the LittleJS engine and the hopon scaffold. Load before writing or changing any game.
---

# Writing a hopon game with LittleJS

A game is one file, `game.ts`, in the workspace. The playtest typechecks it against the runtime's declarations (only what is below, plus the rest of LittleJS 1.26's release build: no plugins, no box2d, no 3D), then runs it as a classic `<script>` after the runtime. Everything below is a global: no `import`, no `export`, no `require`.

## Rules

- Define the hooks with `function gameInit() {}` etc. at top level. The scaffold calls `engineInit` for you; never call it.
- Put all per-round state in `gameInit`: the scaffold calls it again on every restart after destroying all objects.
- Draw everything procedurally (rects, circles, lines, polys, text). There are no image files, no fonts, no network. `fetch`, `XMLHttpRequest`, `localStorage`, `import()` and new windows are blocked by the CSP (`connect-src 'none'`, `sandbox allow-scripts`, no `unsafe-eval`).
- The screen is portrait, at least 360×640 CSS px, often taller. Work in world units: call `setCameraScale(mainCanvasSize.x / 20)` in `gameUpdate` so the screen is 20 units wide, and keep the action within y ∈ [-13, 13]. `setCameraPos(vec2(0, 0))` in `gameInit`.
- Touch is the main input. A tap is `mouseWasPressed(0)`, a held finger is `mouseIsDown(0)`, its world position is `mousePos`. Add arrow keys or Space as a bonus, never as the only control.
- Keep it small: a game is typically 80–200 lines.

## The hopon scaffold

The scaffold owns the start screen ("title" + "hint", tap to start), the score in the top-left corner, the game-over screen and tap-to-restart. While the start or game-over screen shows, the game is paused (`gameUpdate` and objects stop; `gameRender` still draws behind the overlay).

```ts
hopon.title = "Moon Cat"; // set at top level
hopon.hint = "Tap to jump"; // one short line on the start screen
hopon.addScore(1); // add points (ignored unless playing)
hopon.gameOver(); // lose: shows Game over, score and best
hopon.gameOver(true); // win: shows You win!
hopon.score;
hopon.best;
hopon.state; // "start" | "play" | "over"
```

Do not draw your own score, title or game-over text. The scaffold draws the score in the **top-left corner** (about 120×50 CSS px); keep your own HUD (timer, lives, level) out of that corner, e.g. top centre or top right.

## The five hooks

| Hook | When | Use for |
| --- | --- | --- |
| `gameInit()` | once at load and on every restart | reset state, create objects |
| `gameUpdate()` | 60×/s while playing, before objects update | input, spawning, rules |
| `gameUpdatePost()` | 60×/s after objects update, also when paused | camera follow, UI logic |
| `gameRender()` | each frame before objects draw | background |
| `gameRenderPost()` | each frame after objects draw | HUD (screen space) |

`time` is seconds of play since load (it stops while paused), `timeDelta` is 1/60.

## Math and color

- `vec2(x, y)` → `Vector2` with `.add(v) .subtract(v) .scale(n) .multiply(v) .length() .normalize(len?) .distance(v) .angle() .rotate(a) .copy() .lerp(v, p)`. Methods return new vectors; `pos.x += 1` mutates.
- `rgb(r, g, b, a?)` with 0..1 channels, `hsl(h, s, l, a?)` with h in 0..1. Constants: `WHITE BLACK GRAY RED ORANGE YELLOW GREEN CYAN BLUE PURPLE MAGENTA`. `color.lerp(other, p)`, `color.scale(n)`.
- `rand(a?, b?)`, `randInt(a, b?)` (b exclusive), `randBool(chance?)`, `randSign()`, `randInCircle(r)`, `clamp(v, min, max)`, `lerp(a, b, p)`, `isOverlapping(posA, sizeA, posB, sizeB)` (centered boxes), `new Timer(seconds)`: `.active()` and `.elapsed()` are **booleans**; seconds left is `-timer.get()` (it counts up from `-seconds` to 0), `.getPercent()` is 0..1, `.set(s)` restarts it. A countdown: `Math.ceil(-timer.get())`.

## Drawing (world space unless noted)

```ts
drawRect(pos, size, color, angle?)
drawRectGradient(pos, size, colorTop, colorBottom)
drawCircle(pos, diameter, color, lineWidth?, lineColor?)
drawEllipse(pos, size, color, angle?)
drawLine(posA, posB, width?, color?)
drawLineList(points, width?, color?, wrap?, pos?, angle?)   // outline through points, relative to pos
drawPoly(points, color?, lineWidth?, lineColor?, pos?, angle?) // filled polygon, points relative to pos
drawRegularPoly(pos, size, sides, color?)
drawText(text, pos, size?, color?, lineWidth?, lineColor?, align?)  // world space
drawTextScreen(text, screenPos, sizePx, color?, lineWidth?, lineColor?, align?) // CSS px, (0,0) top left
```

`mainCanvasSize` is the screen size in CSS px. `screenToWorld(p)`, `worldToScreen(p)`. In world space y points up.

## EngineObject

```ts
class Ball extends EngineObject {
  constructor(pos: Vector2) {
    super(pos, vec2(1, 1), undefined, 0, RED); // pos, size, tileInfo (always undefined), angle, color
    // no setCollision: hits and pickups are checked by hand (see "Hits and collisions")
    this.velocity = vec2(0.1, 0); // world units per frame (1/60 s)
    this.gravityScale = 1; // multiplies the global setGravity(vec2(0, -0.01))
    this.damping = 1;
    this.mass = 1;
    this.angleVelocity = 0;
    this.renderOrder = 0;
  }
  update() {
    super.update(); /* then your logic; super.update() moves and collides */
  }
  render() {
    drawCircle(this.pos, this.size.x, this.color);
  } // default draws a rect
}
```

`obj.destroy()`, `obj.destroyed`, `obj.getAliveTime()`, `obj.applyForce(v)`, `engineObjects` (all live objects), `engineObjectsCollect(pos, size)`. Gravity defaults to zero.

### Hits and collisions

**Check hits yourself.** For everything that is game logic (an obstacle kills the player, a pickup scores, a bullet hits a bug), test overlap in `gameUpdate` or the object's `update`, and never rely on the physics engine to call you:

```ts
if (isOverlapping(player.pos, player.size.scale(0.8), rock.pos, rock.size))
  die(); // 0.8: a forgiving hitbox
```

Use the engine's physics only to push and bounce things (a ball off walls, a frog landing on a cloud), and know its rules, because a wrong setup fails silently:

- `setCollision(collideSolidObjects, isSolid)`. Two objects interact only if **at least one is solid**: two `setCollision(true, false)` objects pass through each other and `collideWithObject` is never called.
- Only a moving object (`mass > 0`) checks its contacts. A `mass = 0` object is a static wall: it is hit, it never checks.
- `collideWithObject(other)` returns `true` to be pushed apart, `false` to pass through.
- Collision boxes are axis-aligned and **ignore `angle`**: a rotated flipper or ramp collides as its unrotated box. For anything rotated, do the bounce yourself (reflect the velocity when the ball overlaps it).

### Fair games

- Leave the player room: nothing that kills should spawn where the player can't avoid it (spawn away from the player's x, or telegraph it first), and the first threat comes after about 2 s.
- Make it forgiving: hitboxes for dangers a little smaller than their drawing, for targets and pickups a little bigger.
- Everything the player must see is on screen and at least about 1 world unit (18 CSS px) big; a limit the player can hit (a ceiling, a wall) is drawn.

Particles: `new ParticleEmitter(pos, angle, emitSize, emitTime, emitRate, coneAngle, undefined, colorStartA, colorStartB, colorEndA?, colorEndB?, particleTime?, sizeStart?, sizeEnd?, speed?)` — e.g. an explosion: `new ParticleEmitter(pos, 0, 1, 0.2, 100, Math.PI, undefined, YELLOW, RED)`.

## Input

```ts
mouseWasPressed(0) mouseIsDown(0) mouseWasReleased(0) mousePos mousePosScreen  // touch included
keyWasPressed("Space") keyIsDown("ArrowLeft") keyWasReleased("KeyA")          // KeyboardEvent.code
keyDirection() // vec2 from arrows/WASD
```

A swipe is a press, a move and a release. Track it yourself:

```ts
let swipeStart: Vector2 | undefined;
function readSwipe(): Vector2 | undefined {
  if (mouseWasPressed(0)) swipeStart = mousePosScreen.copy();
  if (mouseWasReleased(0) && swipeStart) {
    const d = mousePosScreen.subtract(swipeStart);
    swipeStart = undefined;
    if (d.length() < 30) return undefined; // a tap, not a swipe
    // screen y points down: flip it for world directions
    return Math.abs(d.x) > Math.abs(d.y)
      ? vec2(Math.sign(d.x), 0)
      : vec2(0, -Math.sign(d.y));
  }
  return undefined;
}
```

## Sound (ZzFX)

`const jump = new Sound([volume, randomness, frequency, attack, sustain, release, shape, shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay, sustainVolume, decay, tremolo])` once at top level, then `jump.play(pos?)`. Shape: 0 sine, 1 triangle, 2 saw, 3 tan, 4 noise. Audio unlocks on the first tap (the start screen's), so sounds just work. Good starting points:

```ts
new Sound([0.6, 0, 600, 0.01, 0.05, 0.1, 1, 2, 10]); // jump / flap
new Sound([0.5, 0, 900, 0.01, 0.05, 0.1, 0, 1, 0, 0, 300]); // coin / point
new Sound([1, 0.1, 120, 0.02, 0.2, 0.4, 4, 2, -5]); // hit / crash
new Sound([1, 0, 520, 0.05, 0.3, 0.4, 0, 1, 0, 0, 260, 0.08]); // win jingle
```

## Checking your work

Call `playtest` with inputs for your controls, for example taps on the lanes, or swipes for a snake. The harness taps the centre first, which starts the game, then plays your inputs (times in ms after that tap). Check both screenshots: is the game visible and readable at 360×640, and did something change between them? A game that ends within 3 s gets a warning: give the player time to act.

## Examples

Three complete games. Copy their structure.

### Tap to flap (EngineObject, gravity, collision, particles)

```ts
// Sky Hopper: tap to flap through gaps in the pipes.
hopon.title = "Sky Hopper";
hopon.hint = "Tap to flap";

const WORLD_W = 20;
const flap = new Sound([0.6, 0, 600, 0.01, 0.05, 0.1, 1, 2, 10]);
const crash = new Sound([1, 0.1, 120, 0.02, 0.2, 0.4, 4, 2, -5]);
const point = new Sound([0.5, 0, 900, 0.01, 0.05, 0.1, 0, 1, 0, 0, 300]);

class Bird extends EngineObject {
  constructor() {
    super(vec2(-4, 0), vec2(1, 1), undefined, 0, hsl(0.13, 1, 0.55));
    this.gravityScale = 1;
  }
  update() {
    if (mouseWasPressed(0) || keyWasPressed("Space")) {
      this.velocity = vec2(0, 0.28);
      flap.play(this.pos);
    }
    super.update();
    this.angle = -this.velocity.y * 2;
    if (Math.abs(this.pos.y) > 14) {
      die();
    }
  }
  render() {
    drawCircle(this.pos, 1, this.color);
    drawCircle(this.pos.add(vec2(0.25, 0.15)), 0.25, WHITE);
  }
}

class Pipe extends EngineObject {
  scored = false;
  constructor(x: number, gapY: number, top: boolean) {
    const h = 30;
    const y = top ? gapY + 3 + h / 2 : gapY - 3 - h / 2;
    super(vec2(x, y), vec2(2, h), undefined, 0, hsl(0.33, 0.6, 0.4));
    this.gravityScale = 0;
    this.velocity = vec2(-0.08, 0);
  }
  update() {
    super.update();
    if (this.pos.x < -15) {
      this.destroy();
    }
    // the hit, checked by hand with a forgiving hitbox
    if (isOverlapping(bird.pos, bird.size.scale(0.7), this.pos, this.size)) {
      die();
    }
  }
}

let bird: Bird;
let nextPipe = 0;

function die() {
  crash.play();
  new ParticleEmitter(bird.pos, 0, 0.5, 0.2, 60, 3.14, undefined, YELLOW, RED);
  hopon.gameOver();
}

function gameInit() {
  setGravity(vec2(0, -0.012));
  bird = new Bird();
  nextPipe = 0;
}

function gameUpdate() {
  setCameraScale(mainCanvasSize.x / WORLD_W);
  if (time > nextPipe) {
    nextPipe = time + 1.6;
    const gapY = rand(-6, 6);
    new Pipe(14, gapY, true);
    new Pipe(14, gapY, false);
  }
  for (const o of engineObjects) {
    if (o instanceof Pipe && !o.scored && o.pos.x < bird.pos.x) {
      o.scored = true;
      if (o.pos.y > bird.pos.y) {
        hopon.addScore(1);
        point.play();
      }
    }
  }
}

function gameRender() {
  drawRectGradient(
    cameraPos,
    vec2(100, 100),
    hsl(0.58, 0.7, 0.6),
    hsl(0.55, 0.6, 0.85)
  );
}
```

### Grid puzzle (no EngineObject, tap hit-testing, win)

```ts
// Lights Out: tap a tile to flip it and its neighbours; turn every light off to win.
hopon.title = "Lights Out";
hopon.hint = "Tap tiles to switch them off";

const N = 5;
const TILE = 3.4;
const click = new Sound([0.4, 0, 500, 0, 0.02, 0.05, 1]);
const win = new Sound([1, 0, 520, 0.05, 0.3, 0.4, 0, 1, 0, 0, 260, 0.08]);

let grid: boolean[] = [];
let moves = 0;

const tileCenter = (x: number, y: number) =>
  vec2((x - (N - 1) / 2) * TILE, (y - (N - 1) / 2) * TILE);

function flip(x: number, y: number) {
  for (const [dx, dy] of [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && nx < N && ny >= 0 && ny < N) {
      grid[ny * N + nx] = !grid[ny * N + nx];
    }
  }
}

function gameInit() {
  setCameraPos(vec2(0, 0));
  grid = Array.from({ length: N * N }, () => false);
  // Scramble with random presses so the puzzle is always solvable.
  for (let i = 0; i < 8; i++) {
    flip(randInt(N), randInt(N));
  }
  moves = 0;
}

function gameUpdate() {
  setCameraScale(mainCanvasSize.x / 20);
  if (!mouseWasPressed(0)) {
    return;
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (isOverlapping(mousePos, vec2(0), tileCenter(x, y), vec2(TILE))) {
        flip(x, y);
        moves++;
        click.play();
        if (grid.every((on) => !on)) {
          hopon.addScore(Math.max(1, 50 - moves));
          win.play();
          hopon.gameOver(true);
        }
      }
    }
  }
}

function gameRender() {
  drawRect(cameraPos, vec2(100), hsl(0.7, 0.3, 0.12));
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const on = grid[y * N + x];
      drawRect(
        tileCenter(x, y),
        vec2(TILE - 0.3),
        on ? hsl(0.14, 1, 0.6) : hsl(0.7, 0.2, 0.25)
      );
    }
  }
}

function gameRenderPost() {
  drawTextScreen(
    `Moves ${moves}`,
    vec2(mainCanvasSize.x / 2, mainCanvasSize.y - 30),
    22,
    WHITE
  );
}
```

### Drag to steer (follow finger, spawning, rising difficulty)

```ts
// Star Dodger: drag (or hold left/right) to steer a ship, dodge rocks, grab stars.
hopon.title = "Star Dodger";
hopon.hint = "Drag to steer";

const W = 20;
const pickup = new Sound([0.6, 0, 1200, 0.01, 0.05, 0.15, 0, 1.5, 0, 0, 400]);
const boom = new Sound([1.2, 0.2, 80, 0.01, 0.3, 0.6, 4, 1, -2]);

class Ship extends EngineObject {
  constructor() {
    super(vec2(0, -11), vec2(1.6, 1.6), undefined, 0, hsl(0.5, 1, 0.6));
    this.gravityScale = 0;
  }
  update() {
    if (mouseIsDown(0)) {
      this.pos.x = lerp(this.pos.x, mousePos.x, 0.3);
    }
    this.pos.x +=
      (keyIsDown("ArrowRight") ? 0.3 : 0) - (keyIsDown("ArrowLeft") ? 0.3 : 0);
    this.pos.x = clamp(this.pos.x, -W / 2 + 1, W / 2 - 1);
  }
  render() {
    drawLineList(
      [vec2(0, 1), vec2(0.8, -0.8), vec2(-0.8, -0.8)],
      0.2,
      this.color,
      true,
      this.pos
    );
  }
}

class Faller extends EngineObject {
  star: boolean;
  constructor(star: boolean) {
    super(
      vec2(rand(-W / 2, W / 2), 16),
      vec2(star ? 1 : rand(1, 2.5)),
      undefined,
      rand(6),
      star ? YELLOW : GRAY
    );
    this.star = star;
    this.gravityScale = 0;
    this.velocity = vec2(0, -rand(0.1, 0.2) - time * 0.003);
    this.angleVelocity = rand(-0.1, 0.1);
  }
  update() {
    super.update();
    if (this.pos.y < -16) {
      this.destroy();
      return;
    }
    // hits checked by hand: rocks a little smaller than drawn, stars a little bigger
    const reach = this.size.scale(this.star ? 1.2 : 0.8);
    if (
      !ship.destroyed &&
      isOverlapping(this.pos, reach, ship.pos, ship.size)
    ) {
      this.touch();
    }
  }
  touch() {
    this.destroy();
    if (this.star) {
      hopon.addScore(1);
      pickup.play(this.pos);
    } else {
      boom.play(this.pos);
      new ParticleEmitter(
        ship.pos,
        0,
        1,
        0.3,
        80,
        3.14,
        undefined,
        ORANGE,
        RED
      );
      ship.destroy();
      hopon.gameOver();
    }
  }
  render() {
    if (this.star) {
      drawCircle(this.pos, this.size.x, this.color);
    } else {
      drawRect(this.pos, this.size, this.color, this.angle);
    }
  }
}

let ship: Ship;
let nextSpawn = 0;

function gameInit() {
  setCameraPos(vec2(0, 0));
  ship = new Ship();
  nextSpawn = 0;
}

function gameUpdate() {
  setCameraScale(mainCanvasSize.x / W);
  if (time > nextSpawn) {
    nextSpawn = time + Math.max(0.2, 0.6 - time * 0.01);
    new Faller(randBool(0.25));
  }
}

function gameRender() {
  drawRect(cameraPos, vec2(100), hsl(0.65, 0.5, 0.08));
  for (let i = 0; i < 40; i++) {
    const y = ((i * 7.3 - time * 3) % 32) + 16;
    drawRect(vec2(((i * 13.7) % W) - W / 2, y - 16), vec2(0.08), WHITE);
  }
}
```
