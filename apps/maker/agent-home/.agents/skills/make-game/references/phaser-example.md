# A whole Phaser game: Moon Dash

Open this only when `references/phaser.md` leaves a question about how its pieces fit together. It is one small game, long to read, and every rule it follows is in the guide. Build your own game from its patterns, with its own design, names, look and rules, never a copy of it.

## Example: Moon Dash

A runner. Tap to jump the spikes and grab the coins. Every file but the skeleton is below.

### `src/main.tsx`

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
