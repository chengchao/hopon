# Writing a hopon game in Phaser 4

Phaser is for 2D games where things move: action, arcade, physics, runners, shooters, catchers. The box has Phaser 4.2.1. Phaser 4 is not Phaser 3. Code written from Phaser 3 habits fails the typecheck or draws nothing, so read "Phaser 4 traps" before you write.

## The project

```
index.html        the page: copy it from the example, change only <title> and the background colour
vite.config.ts    copy it from the example
tsconfig.json     copy it from the example
design.md
tests.json
src/main.tsx      the Game, its config and the hopon wiring
src/play.ts       the scene: one class with all the gameplay
src/art.ts        ZOOM, screen() and texture(), copied from the example, then the textures, drawn in code
```

- Add files under `src/` when they help, such as a level table. The entry is always `src/main.tsx`.
- The page's `<title>` is the start screen's title. Set `hopon.hint` in `main.tsx` for the line under it.
- The only package is `phaser`. There is no network and there are no image files, so draw every texture in code (see "Make it look good").
- Import names from `phaser`: `import { AUTO, Game, Scale, Scene, TintModes, Math as PMath } from "phaser"`, and types with `import type { GameObjects, Input, Types } from "phaser"`. Always rename `Math`. A plain `import { Math }` hides JavaScript's `Math` in that file.

## The entry file and the hopon wiring

`src/main.tsx` makes the game and follows the scaffold:

```ts
import { AUTO, Game, Scale } from "phaser";

import { ZOOM } from "./art";
import { Play } from "./play";

hopon.hint = "Tap to jump";

const game = new Game({
  backgroundColor: "#1a1238",
  parent: "root",
  scale: {
    height: window.innerHeight * ZOOM,
    mode: Scale.EXPAND,
    width: window.innerWidth * ZOOM,
  },
  scene: Play,
  type: AUTO,
});

let last = hopon.state;
hopon.subscribe(({ paused, state }) => {
  if (paused && !game.isPaused) {
    game.pause();
  } else if (!paused && game.isPaused) {
    game.resume();
  }
  if (state === "play" && last !== "play") {
    game.scene.getScene("play")?.scene.restart();
  }
  last = state;
});
```

The scene's skeleton:

```ts
export class Play extends Scene {
  private player!: GameObjects.Image;
  private width = 0;
  private speed = 0;

  constructor() {
    super("play");
  }

  create() {
    makeTextures(this);
    const { width, height } = screen(this);
    this.width = width;
    this.speed = 200;
    // ...build the world from width and height
    hopon.ready();
  }

  update(_time: number, delta: number) {
    if (hopon.state === "over") {
      return;
    }
    const dt = Math.min(delta, 50) / 1000;
    // ...idle motion that runs behind the start screen
    if (hopon.state !== "play") {
      return;
    }
    // ...gameplay, moved by dt
    hopon.testVars.playerX = Math.round(this.player.x);
  }
}
```

- **The scene has a key.** `super("play")`, and `getScene("play")` finds it. Without a key its key is `"default"`, so `getScene` finds nothing and rounds never reset.
- **A round starts with `scene.restart()`.** The subscriber restarts the scene whenever the state becomes `"play"`, so every round starts from a fresh `create()`. Restart destroys the scene's objects, tweens, timers and input handlers, and keeps the same scene object, so field initializers don't run again. Set every per-round field at the top of `create()`.
- **`hopon.ready()`** at the end of `create()`.
- **Gameplay runs only in `"play"`.** In `"start"` the scene may idle behind the overlay (a drifting background, a bobbing hero). In `"over"` it freezes. `update` returns at once, and running tweens and particles finish.
- **Move by time.** `delta` is the ms since the last frame. Cap it at 50 ms and move in px per second, never per frame.
- **Score:** `hopon.addScore(1)`. The scaffold draws no score during play, so draw `hopon.score` yourself (see "Text").
- **The end:** call `hopon.gameOver()` (or `hopon.gameOver(true)` for a win) once, then return from `update`. Never call `hopon.start()`.
- **Pause:** the subscriber's `game.pause()` stops the whole game: `update`, tweens, timers, physics and particles. Use the scene's own clocks (`this.tweens`, `this.time`, `delta`), never `setTimeout` or `Date.now()`, so everything stops with it.
- **Music** is the scaffold's. For sound effects, read `references/sound-effects.md`.

## The screen and its units

Every position, size and speed is in px: CSS px, the same px as tests.json's taps. The world is as big as the screen, 360 × 640 on the test phone and taller or wider on many phones, with (0, 0) at the top-left. A tap at (180, 500) is world (180, 500).

The game still draws one canvas pixel per device pixel, up to 2 per px, so it is sharp on a phone's 2x or 3x screen. The box's test phone has 1 device pixel per px, so it draws a quarter of the pixels and a playtest runs fast. Phaser 4 has no `resolution` setting, so three pieces in `src/art.ts` do it. Copy them as they are:

```ts
export const ZOOM = Math.min(window.devicePixelRatio, 2);

export const screen = (scene: Scene) => {
  scene.cameras.main.setZoom(ZOOM).setOrigin(0, 0);
  return { height: scene.scale.height / ZOOM, width: scene.scale.width / ZOOM };
};

// Drawn at ZOOM pixels per px, so it stays sharp under the camera's zoom, and shown at width × height px.
const texture = (
  scene: Scene,
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void
) => {
  const canvas = scene.textures.createCanvas(
    key,
    Math.ceil(width * ZOOM),
    Math.ceil(height * ZOOM)
  );
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext();
  ctx.scale(ZOOM, ZOOM);
  draw(ctx);
  canvas.refresh();
  canvas.source[0].resolution = ZOOM;
  canvas.get().setTrim(width, height, 0, 0, width, height);
};
```

- `main.tsx` makes the canvas `ZOOM` times the window with `Scale.EXPAND`. Keep that config. Don't use `FIT` (black bars) or `RESIZE` (one canvas pixel per px, blurry), and don't set the Scale config's `zoom`.
- `screen(this)` is the first line of `create()` after `makeTextures(this)`. It zooms the camera by `ZOOM` from the top-left and returns the world's `width` and `height`. Place everything from them. The ground and the player go up from the bottom (`height - 110`), the HUD down from the top, and centred things at `width / 2`. Never write 640 or 360 into the layout.
- `this.scale.width` and `this.scale.height` are canvas pixels, `ZOOM` times the world. Never place anything by them.
- A finger's world position is `pointer.worldX` and `pointer.worldY`. `pointer.x`, `downX` and `upX` are canvas pixels.
- Make every texture with `texture()`. A texture drawn at one pixel per px, such as a `generateTexture()` or a bare `createCanvas()`, is blurry on a phone.
- Every Text style has `resolution: ZOOM`, or the text is blurry on a phone.
- Shapes (`this.add.circle`, `ellipse`, `rectangle`) and a live Graphics are sharp with no help.
- Text is at least 18 px, and a tap target is at least 48 px across.

## Phaser 4 traps

Each line is a Phaser 3 habit, then what Phaser 4.2.1 does instead.

- `sprite.setTintFill(0xffffff)` takes no arguments in Phaser 4 and does nothing. A white flash is `sprite.setTint(0xffffff).setTintMode(TintModes.FILL)`, and `sprite.clearTint()` ends it.
- `sprite.preFX` and `postFX` are gone (Phaser 4 has filters). Don't use filters either. Each one renders its object to an extra texture, which is slow on a phone. A glow is an additive glow image (see "Make it look good").
- `this.add.particles(x, y, key, config)` returns the emitter itself. `createEmitter` is gone. For a burst, put `emitting: false` in the config and call `emitter.explode(count, x, y)`.
- `Phaser.Math.PI2` is gone, and `TAU` is now 2π (it was π/2). Write `Math.PI * 2`.
- `Geom.Point` is gone. `graphics.fillPoints()` takes `PMath.Vector2` objects, not `{ x, y }`. Prefer `fillTriangle`, `fillCircle` and `fillRoundedRect`.
- Arcade's `gravity` needs both parts: `{ x: 0, y: 450 }`. `{ y: 450 }` fails the typecheck.
- `graphics.generateTexture()` draws through the canvas renderer, which skips gradients, and its texture is blurry on a phone. Draw every texture with `texture()` and the canvas API.
- `this.textures.createCanvas(key)` with a key already in use logs a console error, which turns the playtest red. A restart runs `create()` again, so make textures once, behind `if (this.textures.exists(key)) return`.
- A `TileSprite` repeats up and down as well as sideways, so its texture's bottom row bleeds into its top edge as a thin line. Leave the bottom 2 px of a sideways-scrolling layer transparent and tuck the layer's bottom behind the ground.
- Keep `type: AUTO`, which picks WebGL. The Canvas renderer is deprecated and skips Graphics gradients.

## Touch controls

The overlay takes the start tap, so the first touch the scene sees is the player's. Read the finger at `pointer.worldX` and `pointer.worldY`, in px.

```ts
// Tap: a short buffer, so a tap just before landing still jumps.
this.input.on("pointerdown", () => {
  this.jumpBuffer = 0.15;
});

// Tap left or right half.
this.input.on("pointerdown", (pointer: Input.Pointer) => {
  this.lane += pointer.worldX < this.width / 2 ? -1 : 1;
});

// Hold: in update.
const holding = this.input.activePointer.isDown;

// Drag: the player follows the finger's x, eased, anywhere on the screen.
const pointer = this.input.activePointer;
if (pointer.isDown) {
  this.player.x += (pointer.worldX - this.player.x) * (1 - 0.5 ** (dt * 60));
}

// Swipe: compare where the finger went down and came up. downX and upX are canvas pixels.
this.input.on("pointerup", (pointer: Input.Pointer) => {
  const dx = (pointer.upX - pointer.downX) / ZOOM;
  const dy = (pointer.upY - pointer.downY) / ZOOM;
  if (Math.hypot(dx, dy) >= 30) {
    this.steer(
      Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)]
    );
  }
});
```

- Let the whole screen be the control. A drag moves the player's x only, so the finger, low on the screen, never covers what it moves.
- A button is a shape at least 48 px across with `.setInteractive()` and `.on("pointerdown", ...)`. Its hit test goes through the camera, so it needs no help.
- Keys are a bonus, never the only control: `this.input.keyboard?.createCursorKeys()` (the keyboard can be null).

## Hits and collisions

Check hits yourself in `update`, with boxes or circles you choose. A danger's hit area is a bit smaller than its drawing, a target's a bit bigger:

```ts
const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
) => Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;

if (
  overlaps(
    { x: hero.x, y: hero.y - 21, w: 26, h: 35 },
    { x: rock.x, y: rock.y, w: rock.width * 0.7, h: rock.height * 0.7 }
  )
) {
  this.crash();
}
if (PMath.Distance.Between(hero.x, hero.y, coin.x, coin.y) < 30) {
  this.collect(coin);
}
```

Use Arcade physics only to push and bounce things (a ball off walls, a crate on a floor):

```ts
// In the Game config:
physics: { arcade: { gravity: { x: 0, y: 450 } }, default: "arcade" },

// In create(), after screen():
this.physics.world.setBounds(0, 0, width, height);
const ball = this.physics.add.image(width / 2, 100, "ball").setBounce(0.8).setCollideWorldBounds(true);
const floor = this.physics.add.staticImage(width / 2, height - 50, "plank").setScale(6, 1).refreshBody();
this.physics.add.collider(ball, floor);
this.physics.add.overlap(ball, star, () => this.collect(star));
ball.setVelocity(100, -300);
if (hopon.state !== "play") {
  this.physics.pause();
}
```

- The world's bounds start as big as the canvas, `ZOOM` times the screen. Set them to the screen with `this.physics.world.setBounds(0, 0, width, height)`, or a phone's walls are off screen.
- Arcade bodies are boxes (or circles, with `body.setCircle(r)`) that ignore rotation. A tilted ramp collides as its unrotated box.
- A static body doesn't follow a scale or a move until you call `refreshBody()`.
- The world steps on its own, so pause it outside play: `this.physics.pause()` in `create()` before the round starts and when the game ends.

## Fair games

- The first threat reaches the player after about 2 s.
- Nothing that kills spawns where the player can't avoid it. Dangers enter from an edge the player can see, with at least 0.6 s between appearing and arriving.
- Space dangers by time, not distance. A gap of `speed * seconds` px stays fair as the game speeds up.
- Hit areas for dangers are smaller than their drawing, for targets and pickups bigger.
- Everything the player must see is on screen and at least 18 px. A limit the player can hit, such as a wall or a ceiling, is drawn.

## Performance

Aim for 60 frames a second on a mid-range phone.

- **Make things once.** Textures and particle emitters in `create()`, reused. Never one emitter per hit.
- **A Text redraws its whole texture on `setText`.** Call it only when the value changes, and keep to a few Texts.
- **Keep counts bounded.** Destroy what leaves the screen, cap spawns, and keep particle `lifespan` under a second.
- **A shape that never changes becomes a texture,** drawn once with `texture()`. A live Graphics is rebuilt every frame.
- **Full-screen layers cost the most.** A sky, two parallax layers and the ground are plenty. The box draws in software, so a heavy scene also makes every playtest slow.
- **No everything-against-everything.** Check hits against the player, not every pair.
- **Images that share a texture draw together.** Reuse a few textures across many objects.

## Make it look good

The game should look finished, like a small game on the App Store, not a prototype of flat shapes on one colour. Spend about a third of the code on looks.

**Palette.** 4 to 6 colours that go together, one hue family plus an accent, and one dark ink colour for every outline and text stroke. Keep them as consts.

**Textures in code.** Make every texture once, in `src/art.ts`, behind the `exists` guard, with `texture()` (see "The screen and its units"). Its `draw` gets a canvas 2D context in px, so draw with the canvas API: `fillRect`, `roundRect`, `arc`, `ellipse`, paths, `stroke`, and linear and radial gradients.

- A character or object is never a bare circle or box. Draw it big (30 to 50 px for the hero), as a dark outline shape with the body inset 3 px inside it, a lighter highlight up and left, a darker shade at the bottom, and a face or detail: eyes with a white glint, a leaf, a stripe. The example's `hero` and `coin` show the layers.
- A round thing gets a radial gradient for a lit, 3D look:

```ts
const body = ctx.createRadialGradient(12, 15, 1, 16, 19, 12);
body.addColorStop(0, "#ff7a7a");
body.addColorStop(0.5, "#e02633");
body.addColorStop(1, "#a3121f");
ctx.fillStyle = body;
ctx.beginPath();
ctx.arc(16, 19, 11, 0, Math.PI * 2);
ctx.fill();
```

**A background in layers,** never one flat fill:

- A sky gradient: a 2 × 256 texture stretched over the screen with `this.add.image(0, 0, "sky").setOrigin(0).setDisplaySize(width, height)`.
- A light: a sun or moon circle with the example's `glow` texture behind it (a radial white-to-clear gradient), drawn with `.setBlendMode("ADD").setAlpha(0.4).setScale(3)`. The same glow, tinted and small, makes sparks, gems and lamps shine.
- Life: stars that twinkle (`this.tweens.add({ targets: star, alpha: 0.2, yoyo: true, repeat: -1, duration: 900 })`), clouds that drift.
- Depth: 1 or 2 parallax layers (`this.add.tileSprite(0, groundY + 4, width, 150, "hills").setOrigin(0, 1)`), each scrolling slower the farther it is (`hills.tilePositionX += speed * dt * 0.3`), paler and bluer the farther it is, with a lighter rim along its top. Draw a layer that tiles as sines that repeat over its width, so it has no seam.
- The ground: a gradient strip with a bright top edge and a little texture (stripes, tufts), filling the screen down to its bottom.

**Depth and order.** A soft shadow ellipse under things on the ground (`this.add.ellipse(x, groundY + 2, 36, 8, 0x000000, 0.3)`), shrinking as they rise. Set depths once: background 0, things 5, the player 10, particles 20, the HUD 30.

**Juice.** Every jump, hit, pickup and death gets feedback:

```ts
// One emitter per effect, made in create(), fired with explode().
this.sparkle = this.add
  .particles(0, 0, "dot", {
    blendMode: "ADD",
    emitting: false,
    lifespan: 500,
    scale: { end: 0, start: 0.8 },
    speed: { max: 190, min: 60 },
    tint: 0xffd166,
  })
  .setDepth(20);
this.sparkle.explode(14, coin.x, coin.y);

// A burst that changes colour as it fades: color, not tint.
this.add.particles(0, 0, "dot", {
  color: [0xffffff, 0xff6b6b, 0x5b2a86],
  emitting: false,
  gravityY: 450,
  lifespan: 800,
  scale: { end: 0, start: 1.4 },
  speed: { max: 350, min: 100 },
});

// Squash and stretch on a jump or a landing.
this.hero.setScale(1.3, 0.75);
this.tweens.add({
  targets: this.hero,
  scaleX: 1,
  scaleY: 1,
  duration: 180,
  ease: "Back.easeOut",
});

// A pickup pops, then goes.
this.tweens.add({
  targets: coin,
  scale: 1.8,
  alpha: 0,
  duration: 200,
  onComplete: () => coin.destroy(),
});

// A coin spins.
this.tweens.add({
  targets: coin,
  scaleX: 0.3,
  yoyo: true,
  repeat: -1,
  duration: 420,
});

// "+1" floats up from where the point was won.
const plus = this.add.text(x, y, "+1", style).setOrigin(0.5).setDepth(25);
this.tweens.add({
  targets: plus,
  y: y - 45,
  alpha: 0,
  duration: 600,
  onComplete: () => plus.destroy(),
});

// A hit: shake, flash, and the hero flashes white for 80 ms.
this.cameras.main.shake(300, 0.012).flash(150, 255, 240, 220);
this.hero.setTint(0xffffff).setTintMode(TintModes.FILL);
this.time.delayedCall(80, () => this.hero.clearTint());
```

- Things that move lean into it: `hero.angle = PMath.Clamp(-vy * 0.016, -12, 12)`. Pickups bob or spin, enemies wobble.
- Ease every tween: `"Back.easeOut"` for a pop, `"Cubic.easeOut"` for a fall or a fade.

**Text.** Bold, white or near-white, with a thick dark stroke and a drop shadow, so it reads on any background, and `resolution: ZOOM`, so it is sharp:

```ts
const FONT = "system-ui, -apple-system, Roboto, sans-serif";
this.scoreText = this.add
  .text(width / 2, 55, "0", {
    color: "#ffffff",
    fontFamily: FONT,
    fontSize: "38px",
    fontStyle: "bold",
    resolution: ZOOM,
    stroke: "#2b1236",
    strokeThickness: 7,
  })
  .setOrigin(0.5)
  .setShadow(0, 3, "rgba(0,0,0,0.35)", 0, true, true)
  .setDepth(30);
```

Pop the score when it changes: `setScale(1.25)`, then tween back to 1.

## Example: Moon Dash

A runner. Tap to jump the spikes and grab the coins. Every file is below.

### `index.html`

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Moon Dash</title>
    <style>
      html,
      body,
      #root {
        margin: 0;
        height: 100%;
        overflow: hidden;
        background: #1a1238;
      }
    </style>
    <script src="/hopon/v1.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### `vite.config.ts`

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({ plugins: [react()] });
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["es2022", "dom"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "skipLibCheck": true,
    "strict": true,
    "target": "es2022",
    "types": []
  },
  "include": ["src"]
}
```

### `src/main.tsx`

```ts
import { AUTO, Game, Scale } from "phaser";

import { ZOOM } from "./art";
import { Play } from "./play";

hopon.hint = "Tap to jump";

const game = new Game({
  backgroundColor: "#1a1238",
  parent: "root",
  scale: {
    height: window.innerHeight * ZOOM,
    mode: Scale.EXPAND,
    width: window.innerWidth * ZOOM,
  },
  scene: Play,
  type: AUTO,
});

let last = hopon.state;
hopon.subscribe(({ paused, state }) => {
  if (paused && !game.isPaused) {
    game.pause();
  } else if (!paused && game.isPaused) {
    game.resume();
  }
  if (state === "play" && last !== "play") {
    game.scene.getScene("play")?.scene.restart();
  }
  last = state;
});
```

### `src/play.ts`

```ts
import { Math as PMath, Scene, TintModes } from "phaser";
import type { GameObjects } from "phaser";

import { FONT, INK, ZOOM, makeTextures, screen } from "./art";

const GRAVITY = 1800;
const JUMP_SPEED = 750;
const START_SPEED = 215;
const MAX_SPEED = 380;
const HERO_X = 85;
const GROUND = 110;

interface Thing {
  image: GameObjects.Image;
  kind: "spike" | "coin";
  passed: boolean;
}

const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
) => Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;

export class Play extends Scene {
  private hero!: GameObjects.Image;
  private shadow!: GameObjects.Ellipse;
  private far!: GameObjects.TileSprite;
  private near!: GameObjects.TileSprite;
  private ground!: GameObjects.TileSprite;
  private scoreText!: GameObjects.Text;
  private dust!: GameObjects.Particles.ParticleEmitter;
  private sparkle!: GameObjects.Particles.ParticleEmitter;
  private burst!: GameObjects.Particles.ParticleEmitter;
  private things: Thing[] = [];
  private width = 0;
  private floor = 0;
  private lift = 0;
  private vy = 0;
  private jumpBuffer = 0;
  private speed = START_SPEED;
  private distance = 0;
  private untilNext = 0;
  private shownScore = -1;

  constructor() {
    super("play");
  }

  create() {
    makeTextures(this);
    const { width: w, height: h } = screen(this);
    this.width = w;
    this.floor = h - GROUND;
    this.things = [];
    this.lift = 0;
    this.vy = 0;
    this.jumpBuffer = 0;
    this.speed = START_SPEED;
    this.distance = 0;
    this.untilNext = START_SPEED * 2.6;
    this.shownScore = -1;

    this.add.image(0, 0, "sky").setOrigin(0).setDisplaySize(w, h);
    for (let i = 0; i < 40; i += 1) {
      const star = this.add
        .image(PMath.Between(0, w), PMath.Between(0, h * 0.5), "dot")
        .setScale(PMath.FloatBetween(0.15, 0.4));
      this.tweens.add({
        alpha: 0.2,
        delay: PMath.Between(0, 1500),
        duration: PMath.Between(600, 1400),
        repeat: -1,
        targets: star,
        yoyo: true,
      });
    }
    this.add
      .image(w * 0.74, h * 0.2, "glow")
      .setScale(2.6)
      .setAlpha(0.35)
      .setBlendMode("ADD");
    this.add.circle(w * 0.74, h * 0.2, 32, 0xff_f4_d6);
    this.add.circle(w * 0.74 - 10, h * 0.2 - 7, 7, 0xe8_d9_b0);
    this.add.circle(w * 0.74 + 12, h * 0.2 + 9, 4.5, 0xe8_d9_b0);
    this.far = this.add
      .tileSprite(0, this.floor + 4, w, 160, "far")
      .setOrigin(0, 1);
    this.near = this.add
      .tileSprite(0, this.floor + 4, w, 130, "near")
      .setOrigin(0, 1);
    this.ground = this.add
      .tileSprite(0, this.floor, w, GROUND, "ground")
      .setOrigin(0, 0);

    this.shadow = this.add
      .ellipse(HERO_X, this.floor + 2, 36, 8, 0x00_00_00, 0.3)
      .setDepth(9);
    this.hero = this.add
      .image(HERO_X, this.floor, "hero")
      .setOrigin(0.5, 1)
      .setDepth(10);
    this.dust = this.add
      .particles(0, 0, "dot", {
        alpha: { end: 0, start: 0.8 },
        angle: { max: 340, min: 200 },
        emitting: false,
        gravityY: 150,
        lifespan: 450,
        scale: { end: 0, start: 0.9 },
        speed: { max: 110, min: 30 },
        tint: 0xcf_c3_e8,
      })
      .setDepth(20);
    this.sparkle = this.add
      .particles(0, 0, "dot", {
        blendMode: "ADD",
        emitting: false,
        lifespan: 500,
        scale: { end: 0, start: 0.8 },
        speed: { max: 190, min: 60 },
        tint: 0xff_d1_66,
      })
      .setDepth(20);
    this.burst = this.add
      .particles(0, 0, "dot", {
        color: [0xff_ff_ff, 0xff_6b_6b, 0x5b_2a_86],
        emitting: false,
        gravityY: 450,
        lifespan: 800,
        scale: { end: 0, start: 1.4 },
        speed: { max: 350, min: 100 },
      })
      .setDepth(20);
    this.scoreText = this.add
      .text(w / 2, 55, "0", {
        color: "#ffffff",
        fontFamily: FONT,
        fontSize: "38px",
        fontStyle: "bold",
        resolution: ZOOM,
        stroke: INK,
        strokeThickness: 7,
      })
      .setOrigin(0.5)
      .setShadow(0, 3, "rgba(0,0,0,0.35)", 0, true, true)
      .setDepth(30)
      .setVisible(hopon.state === "play");

    this.input.on("pointerdown", () => {
      this.jumpBuffer = 0.15;
    });
    hopon.ready();
  }

  update(_time: number, delta: number) {
    if (hopon.state === "over") {
      return;
    }
    const dt = Math.min(delta, 50) / 1000;
    const playing = hopon.state === "play";
    const move = (playing ? this.speed : 60) * dt;
    this.far.tilePositionX += move * 0.2;
    this.near.tilePositionX += move * 0.5;
    this.ground.tilePositionX += move;
    if (!playing) {
      this.hero.y = this.floor - Math.abs(Math.sin(this.time.now / 200)) * 20;
      return;
    }

    this.speed = Math.min(MAX_SPEED, this.speed + 4.5 * dt);
    this.distance += move;
    this.jumpBuffer -= dt;
    if (this.jumpBuffer > 0 && this.lift === 0) {
      this.jumpBuffer = 0;
      this.vy = JUMP_SPEED;
      this.squash(0.8, 1.25);
    }
    if (this.lift > 0 || this.vy > 0) {
      this.vy -= GRAVITY * dt;
      this.lift = Math.max(0, this.lift + this.vy * dt);
      if (this.lift === 0) {
        this.vy = 0;
        this.squash(1.3, 0.75);
        this.dust.explode(10, HERO_X, this.floor);
      }
    }
    this.hero.y = this.floor - this.lift;
    this.hero.angle = PMath.Clamp(-this.vy * 0.016, -12, 12);
    this.shadow.setScale(Math.max(0.4, 1 - this.lift / 250));

    this.untilNext -= move;
    if (this.untilNext <= 0) {
      this.spawn();
    }
    const body = { h: 35, w: 26, x: HERO_X, y: this.hero.y - 21 };
    for (const thing of this.things) {
      const { image } = thing;
      image.x -= move;
      if (thing.kind === "spike") {
        if (overlaps(body, { h: 22, w: 15, x: image.x, y: image.y - 11 })) {
          this.crash();
          return;
        }
        if (!thing.passed && image.x < HERO_X - 20) {
          thing.passed = true;
          hopon.addScore(1);
        }
      } else if (
        !thing.passed &&
        overlaps(body, { h: 38, w: 38, x: image.x, y: image.y })
      ) {
        thing.passed = true;
        hopon.addScore(1);
        this.sparkle.explode(14, image.x, image.y);
        this.tweens.killTweensOf(image);
        this.tweens.add({
          alpha: 0,
          duration: 200,
          onComplete: () => image.destroy(),
          scale: 1.8,
          targets: image,
        });
      }
    }
    this.things = this.things.filter((thing) => {
      if (thing.image.x > -40 && thing.image.active) {
        return true;
      }
      thing.image.destroy();
      return false;
    });

    if (hopon.score !== this.shownScore) {
      this.shownScore = hopon.score;
      this.scoreText
        .setText(String(hopon.score))
        .setVisible(true)
        .setScale(1.25);
      this.tweens.add({ duration: 160, scale: 1, targets: this.scoreText });
    }
    hopon.testVars.heroHeight = Math.round(this.lift);
    hopon.testVars.distance = Math.round(this.distance);
  }

  private squash(x: number, y: number) {
    this.hero.setScale(x, y);
    this.tweens.add({
      duration: 180,
      ease: "Back.easeOut",
      scaleX: 1,
      scaleY: 1,
      targets: this.hero,
    });
  }

  private spawn() {
    const x = this.width + 30;
    const count = this.speed > 280 && Math.random() < 0.35 ? 2 : 1;
    for (let i = 0; i < count; i += 1) {
      const image = this.add
        .image(x + i * 28, this.floor + 2, "spike")
        .setOrigin(0.5, 1)
        .setDepth(5);
      this.things.push({ image, kind: "spike", passed: false });
    }
    if (Math.random() < 0.7) {
      const middle = x + (count - 1) * 14;
      for (const dx of [-55, 0, 55]) {
        const image = this.add
          .image(middle + dx, this.floor - 135 - (dx === 0 ? 25 : 0), "coin")
          .setDepth(5);
        this.tweens.add({
          duration: 420,
          repeat: -1,
          scaleX: 0.3,
          targets: image,
          yoyo: true,
        });
        this.things.push({ image, kind: "coin", passed: false });
      }
    }
    this.untilNext =
      PMath.Between(Math.round(this.speed * 1.15), Math.round(this.speed * 2)) +
      80;
  }

  private crash() {
    this.cameras.main.shake(350, 0.012).flash(180, 255, 240, 220);
    this.burst.explode(36, HERO_X, this.hero.y - 21);
    this.hero.setTint(0xff_ff_ff).setTintMode(TintModes.FILL);
    this.tweens.add({
      alpha: 0,
      angle: -200,
      duration: 700,
      ease: "Cubic.easeOut",
      targets: this.hero,
      y: this.hero.y - 70,
    });
    hopon.gameOver();
  }
}
```

### `src/art.ts`

```ts
import type { Scene } from "phaser";

export const ZOOM = Math.min(window.devicePixelRatio, 2);
export const INK = "#2b1236";
export const FONT = "system-ui, -apple-system, Roboto, sans-serif";

export const screen = (scene: Scene) => {
  scene.cameras.main.setZoom(ZOOM).setOrigin(0, 0);
  return { height: scene.scale.height / ZOOM, width: scene.scale.width / ZOOM };
};

// Drawn at ZOOM pixels per px, so it stays sharp under the camera's zoom, and shown at width × height px.
const texture = (
  scene: Scene,
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void
) => {
  const canvas = scene.textures.createCanvas(
    key,
    Math.ceil(width * ZOOM),
    Math.ceil(height * ZOOM)
  );
  if (!canvas) {
    return;
  }
  const ctx = canvas.getContext();
  ctx.scale(ZOOM, ZOOM);
  draw(ctx);
  canvas.refresh();
  canvas.source[0].resolution = ZOOM;
  canvas.get().setTrim(width, height, 0, 0, width, height);
};

// A ridge whose sines repeat every `width` px, so the layer tiles without a seam.
const ridge = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  base: number,
  waves: [number, number][],
  light: string,
  dark: string,
  rim: string
) => {
  const top = new Path2D();
  for (let x = 0; x <= width; x += 2) {
    const y = waves.reduce(
      (sum, [count, amp]) =>
        sum + Math.sin((x / width) * Math.PI * 2 * count) * amp,
      base
    );
    top.lineTo(x, y);
  }
  const body = new Path2D(top);
  body.lineTo(width, height - 2);
  body.lineTo(0, height - 2);
  const fill = ctx.createLinearGradient(0, 0, 0, height);
  fill.addColorStop(0, light);
  fill.addColorStop(1, dark);
  ctx.fillStyle = fill;
  ctx.fill(body);
  ctx.strokeStyle = rim;
  ctx.lineWidth = 2;
  ctx.stroke(top);
};

const circle = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string
) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
};

export const makeTextures = (scene: Scene) => {
  if (scene.textures.exists("sky")) {
    return;
  }
  texture(scene, "sky", 2, 256, (ctx) => {
    const sky = ctx.createLinearGradient(0, 0, 0, 256);
    sky.addColorStop(0, "#1a1238");
    sky.addColorStop(0.55, "#5b2a86");
    sky.addColorStop(1, "#f08a5d");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 2, 256);
  });
  texture(scene, "glow", 64, 64, (ctx) => {
    const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    glow.addColorStop(0, "rgba(255,255,255,1)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 64, 64);
  });
  texture(scene, "far", 360, 160, (ctx) =>
    ridge(
      ctx,
      360,
      160,
      75,
      [
        [2, 30],
        [5, 11],
      ],
      "#7a3f9e",
      "#4a2a78",
      "#b073c9"
    )
  );
  texture(scene, "near", 360, 130, (ctx) =>
    ridge(
      ctx,
      360,
      130,
      60,
      [
        [3, 20],
        [7, 6],
      ],
      "#3b2466",
      "#24163f",
      "#6a4a9a"
    )
  );
  texture(scene, "ground", 64, 110, (ctx) => {
    const dirt = ctx.createLinearGradient(0, 0, 0, 110);
    dirt.addColorStop(0, "#5a3a7a");
    dirt.addColorStop(1, "#2a1840");
    ctx.fillStyle = dirt;
    ctx.fillRect(0, 0, 64, 110);
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(0, 35, 32, 9);
    ctx.fillRect(32, 65, 32, 9);
    ctx.fillStyle = "#55d6be";
    ctx.fillRect(0, 0, 64, 13);
    ctx.fillStyle = "#9df0dc";
    ctx.fillRect(0, 0, 64, 3.5);
    ctx.fillStyle = "#2f9c8a";
    for (let x = 0; x < 64; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 13);
      ctx.lineTo(x + 8, 20);
      ctx.lineTo(x + 16, 13);
      ctx.fill();
    }
  });
  texture(scene, "hero", 42, 42, (ctx) => {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.roundRect(1, 1, 40, 40, 12);
    ctx.fill();
    ctx.fillStyle = "#ff6b6b";
    ctx.beginPath();
    ctx.roundRect(4, 4, 34, 34, 9.5);
    ctx.fill();
    ctx.fillStyle = "#ff9e8a";
    ctx.beginPath();
    ctx.roundRect(7, 6, 22, 11, 5.5);
    ctx.fill();
    ctx.fillStyle = "#d9485a";
    ctx.beginPath();
    ctx.roundRect(4, 29, 34, 9, [0, 0, 9.5, 9.5]);
    ctx.fill();
    circle(ctx, 26, 17, 6.5, "#ffffff");
    circle(ctx, 28, 17.5, 3.5, INK);
    circle(ctx, 29, 16, 1.25, "#ffffff");
    circle(ctx, 15, 25, 3, "rgba(255,194,209,0.8)");
  });
  texture(scene, "spike", 32, 36, (ctx) => {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.moveTo(0, 36);
    ctx.lineTo(16, 0);
    ctx.lineTo(32, 36);
    ctx.fill();
    ctx.fillStyle = "#e8e4f0";
    ctx.beginPath();
    ctx.moveTo(4, 33);
    ctx.lineTo(16, 6);
    ctx.lineTo(28, 33);
    ctx.fill();
    ctx.fillStyle = "#a89cc8";
    ctx.beginPath();
    ctx.moveTo(16, 6);
    ctx.lineTo(28, 33);
    ctx.lineTo(16, 33);
    ctx.fill();
  });
  texture(scene, "coin", 26, 26, (ctx) => {
    circle(ctx, 13, 13, 13, INK);
    circle(ctx, 13, 13, 10.5, "#f2a541");
    circle(ctx, 12, 12, 8, "#ffd166");
    circle(ctx, 9.5, 9, 2.5, "#fff3c4");
  });
  texture(scene, "dot", 8, 8, (ctx) => circle(ctx, 4, 4, 4, "#ffffff"));
};
```

### `tests.json`

```json
{
  "expose": [
    {
      "name": "heroHeight",
      "means": "how high the runner's feet are above the ground, in px; 0 on the ground"
    },
    {
      "name": "distance",
      "means": "how far the runner has run this round, in px"
    }
  ],
  "tests": [
    {
      "name": "a tap makes the runner jump and land",
      "inputs": [{ "at": 600, "type": "tap", "x": 180, "y": 400 }],
      "checks": [
        { "at": 500, "expect": "vars.heroHeight === 0" },
        { "at": 900, "expect": "vars.heroHeight > 100" },
        { "at": 1800, "expect": "vars.heroHeight === 0 && state === 'play'" }
      ]
    },
    {
      "name": "a runner who never jumps hits a spike and the round ends",
      "inputs": [],
      "checks": [
        { "at": 2000, "expect": "state === 'play'" },
        { "at": 6000, "expect": "state === 'over'" }
      ]
    },
    {
      "name": "the run stops while the feed has the game paused",
      "inputs": [
        { "at": 600, "type": "pause" },
        { "at": 1600, "type": "resume" }
      ],
      "checks": [
        { "at": 500, "expect": "vars.distance > 0" },
        { "at": 700, "expect": "vars.distance > 0" },
        { "at": 1500, "expect": "vars.distance === prev.vars.distance" },
        { "at": 2200, "expect": "vars.distance > prev.vars.distance" }
      ]
    }
  ]
}
```

## Checking your work

- **tests.json reads `hopon.testVars`.** Set each exposed value in `update` from the real state, every frame: `hopon.testVars.heroHeight = Math.round(this.lift)`.
- **Inputs are world px.** A tap at (180, 500) on the 360 × 640 test phone is `pointer.worldX` 180 and `pointer.worldY` 500. A tap holds for 2 frames and a swipe moves over 6, so a held control sees the finger for those frames only.
- **Test the pause.** Expose a value that grows while the game runs, such as `distance`, and check it stops between `{"type": "pause"}` and `{"type": "resume"}`, as the example's third test does.
- **Look at both screenshots.** The start screenshot is taken just after the start tap, in play. Check that nothing is cut off at the edges, the text is readable, and the scene has depth: a gradient, layers, outlines, shadows.
- **The box draws in software,** so a Phaser playtest runs slower than real time, about 3 s of wall time per second of play for a full scene. Keep each test to the seconds it needs.
