# Writing a hopon game in Phaser 4

Phaser is for 2D games where things move, and for games with a world to move around in. The box has Phaser 4.2.1. Phaser 4 is not Phaser 3. Code written from Phaser 3 habits fails the typecheck or draws nothing, so read "Phaser 4 traps" before you write.

## The project

```
index.html, vite.config.ts, tsconfig.json   the skeleton: `node /opt/hopon/starter.js` wrote them (make-game). Keep them as they are
design.md
tests.json
src/main.tsx      the Game, its config and the hopon wiring
src/play.ts       the scene: what the player sees and touches
src/art.ts        ZOOM, screen() and texture() (see "The screen and its units"), then the textures, drawn in code
src/rules.ts      the game's state and rules, with no Phaser in it, when the game has more than moving and hitting
```

- **One scene for each screen.** A game that plays on one screen has one scene, `src/play.ts`. A game the player moves through, such as a map, a shop and a battle, has a scene for each: read `references/phaser-scenes.md` before you write it. Never put several screens into one scene behind a flag.
- **Rules apart from scenes.** When the game has turns, prices, an inventory, a map or levels, keep that state and its rules in `src/rules.ts` as data and plain functions that import nothing from Phaser. A scene reads the state, draws it, and calls a rule when the player acts. A new round is then a new state, and a scene can be built again from it at any time.
- Add files under `src/` when they help, such as a level table. The entry is always `src/main.tsx`.
- Set `hopon.title` and `hopon.hint` at the top of `main.tsx`: the start screen's title and the line under it.
- The only package is `phaser`. There is no network and there are no image files, so draw every texture in code (see "Make it look good").
- Import names from `phaser`: `import { AUTO, Game, Scale, Scene, TintModes, Math as PMath } from "phaser"`, and types with `import type { GameObjects, Input, Types } from "phaser"`. Always rename `Math`. A plain `import { Math }` hides JavaScript's `Math` in that file.

## The entry file and the hopon wiring

`src/main.tsx` makes the game and follows the scaffold:

```ts
import { AUTO, Game, Scale } from "phaser";

import { ZOOM } from "./art";
import { Play } from "./play";

hopon.title = "Moon Dash";
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
- A panel of words and buttons (a shop, an inventory, a dialogue) is not drawn in Phaser, which has no lists, wrapping or layout. It is React over the canvas: read `references/phaser-panels.md`.
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

```ts
export const makeTextures = (scene: Scene) => {
  // A restart runs create() again, and a key made twice is a console error.
  if (scene.textures.exists("hero")) {
    return;
  }
  texture(scene, "hero", 44, 48, (ctx) => {
    // ...outline, body, highlight, face
  });
  // ...every other texture
};
```

- A character or object is never a bare circle or box. Draw it big (30 to 50 px for the hero), as a dark outline shape with the body inset 3 px inside it, a lighter highlight up and left, a darker shade at the bottom, and a face or detail: eyes with a white glint, a leaf, a stripe.
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
- A light: a sun or moon circle with a `glow` texture behind it (a radial gradient from white to clear, drawn once with `texture()`), shown with `.setBlendMode("ADD").setAlpha(0.4).setScale(3)`. The same glow, tinted and small, makes sparks, gems and lamps shine.
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

## Checking your work

- **tests.json reads `hopon.testVars`.** Set each exposed value in `update` from the real state, every frame: `hopon.testVars.heroHeight = Math.round(this.lift)`.
- **Inputs are world px.** A tap at (180, 500) on the 360 × 640 test phone is `pointer.worldX` 180 and `pointer.worldY` 500. A tap holds for 2 frames and a swipe moves over 6, so a held control sees the finger for those frames only.
- **Test the pause.** Expose a value that grows while the game runs, such as `distance`, and check it stops between `{"type": "pause"}` and `{"type": "resume"}`, as this test does: `"inputs": [{ "at": 600, "type": "pause" }, { "at": 1600, "type": "resume" }]` with the checks `{ "at": 700, "expect": "vars.distance > 0" }`, `{ "at": 1500, "expect": "vars.distance === prev.vars.distance" }` and `{ "at": 2200, "expect": "vars.distance > prev.vars.distance" }`.
- **Look at both screenshots.** The start screenshot is taken just after the start tap, in play. Check that nothing is cut off at the edges, the text is readable, and the scene has depth: a gradient, layers, outlines, shadows.
- **The box draws in software,** so a Phaser playtest runs slower than real time, about 3 s of wall time per second of play for a full scene. Keep each test to the seconds it needs.
