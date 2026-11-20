import { Math as PMath, Scene, TintModes } from "phaser";
import type { GameObjects, Types } from "phaser";

import { FONT, OUTLINE, ZOOM, makeTextures, screen } from "./art";

// The design's numbers are in units: the screen is 20 wide, heights from its middle, up positive, per 60 fps frame.
const UNITS_WIDE = 20;
const BASKET_Y = -11;
const GROUND_TOP = -12.3;
const EDGE = 1.8;

interface Item {
  x: number;
  y: number;
  v: number;
  bomb: boolean;
  image: GameObjects.Image;
  spark?: GameObjects.Image;
}

export class Catch extends Scene {
  private width = 0;
  private unit = 0;
  private middle = 0;
  private basket!: GameObjects.Image;
  private shadow!: GameObjects.Ellipse;
  private clouds: GameObjects.Image[] = [];
  private scoreText!: GameObjects.Text;
  private juice!: GameObjects.Particles.ParticleEmitter;
  private blast!: GameObjects.Particles.ParticleEmitter;
  private keys?: Types.Input.Keyboard.CursorKeys;
  private items: Item[] = [];
  private bx = 0;
  private spawnT = 0;
  private bombsCaught = 0;
  private shownScore = -1;

  constructor() {
    super("catch");
  }

  create() {
    makeTextures(this);
    const { width: w, height: h } = screen(this);
    this.width = w;
    this.unit = w / UNITS_WIDE;
    this.middle = h / 2;
    this.items = [];
    this.bx = 0;
    this.spawnT = 1;
    this.bombsCaught = 0;
    this.shownScore = -1;

    this.add.image(0, 0, "sky").setOrigin(0).setDisplaySize(w, h);
    this.add
      .image(w * 0.82, h * 0.1, "glow")
      .setScale(2.6)
      .setAlpha(0.55)
      .setBlendMode("ADD");
    this.add.circle(w * 0.82, h * 0.1, 26, 0xff_f6_c8);
    this.clouds = [0.2, 0.34, 0.5].map((y, i) =>
      this.add
        .image(PMath.Between(0, w), h * y, "cloud")
        .setScale(1.3 - i * 0.3)
        .setAlpha(0.95 - i * 0.2)
    );
    const groundY = this.toY(GROUND_TOP);
    this.add.tileSprite(0, groundY + 15, w, 130, "hills").setOrigin(0, 1);
    this.add.tileSprite(0, groundY, w, h - groundY, "ground").setOrigin(0, 0);
    this.shadow = this.add.ellipse(
      w / 2,
      groundY + 5,
      75,
      11,
      0x00_00_00,
      0.22
    );
    this.basket = this.add
      .image(w / 2, this.toY(BASKET_Y), "basket")
      .setDepth(10);

    this.juice = this.add
      .particles(0, 0, "dot", {
        color: [0xff_f1_a8, 0xff_6b_6b, 0x5f_d9_26],
        emitting: false,
        gravityY: 350,
        lifespan: 550,
        scale: { end: 0, start: 0.9 },
        speed: { max: 210, min: 70 },
      })
      .setDepth(20);
    this.blast = this.add
      .particles(0, 0, "dot", {
        color: [0xff_ff_d0, 0xff_d0_00, 0xff_50_20, 0x40_20_20],
        emitting: false,
        lifespan: 900,
        scale: { end: 0, start: 2.2 },
        speed: { max: 450, min: 100 },
      })
      .setDepth(20);
    this.scoreText = this.add
      .text(16, 13, "0", {
        color: "#ffffff",
        fontFamily: FONT,
        fontSize: "32px",
        fontStyle: "bold",
        resolution: ZOOM,
        stroke: OUTLINE,
        strokeThickness: 6,
      })
      .setShadow(0, 2.5, "rgba(0,0,0,0.3)", 0, true, true)
      .setDepth(30)
      .setVisible(hopon.state === "play");
    this.keys = this.input.keyboard?.createCursorKeys();
    hopon.ready();
  }

  private toX(x: number) {
    return this.width / 2 + x * this.unit;
  }

  private toY(y: number) {
    return this.middle - y * this.unit;
  }

  update(time: number, delta: number) {
    if (hopon.state === "over") {
      return;
    }
    const dt = Math.min(delta, 50) / 1000;
    const frames = dt * 60;
    for (const [i, cloud] of this.clouds.entries()) {
      cloud.x += (7 - i * 2) * dt;
      if (cloud.x > this.width + 70) {
        cloud.x = -70;
      }
    }
    if (hopon.state !== "play") {
      return;
    }

    const pointer = this.input.activePointer;
    if (pointer.isDown) {
      const target = (pointer.worldX - this.width / 2) / this.unit;
      this.bx += (target - this.bx) * (1 - 0.5 ** frames);
    }
    const arrows =
      (this.keys?.right.isDown ? 0.4 : 0) - (this.keys?.left.isDown ? 0.4 : 0);
    this.bx = PMath.Clamp(
      this.bx + arrows * frames,
      -UNITS_WIDE / 2 + EDGE,
      UNITS_WIDE / 2 - EDGE
    );
    this.basket.x = this.toX(this.bx);
    this.shadow.x = this.basket.x;
    hopon.testVars.basketX = (this.bx + UNITS_WIDE / 2) / UNITS_WIDE;
    hopon.testVars.bombsCaught = this.bombsCaught;

    const { score } = hopon;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = Math.max(0.3, 0.9 - score * 0.02);
      const count =
        1 +
        (score > 15 && Math.random() < 0.4 ? 1 : 0) +
        (score > 35 && Math.random() < 0.4 ? 1 : 0);
      for (let i = 0; i < count; i += 1) {
        this.drop(14 + i * 2, score);
      }
    }

    for (const item of this.items) {
      item.y -= item.v * frames;
      item.image.setPosition(this.toX(item.x), this.toY(item.y));
      item.image.angle = Math.sin(time / 180 + item.x) * 8;
      if (item.spark) {
        const flicker = time % 200 < 100;
        item.spark
          .setPosition(item.image.x + 7, item.image.y - 15)
          .setTint(flicker ? 0xff_ee_33 : 0xff_88_00)
          .setScale(flicker ? 0.32 : 0.24);
      }
      if (
        item.y < BASKET_Y + 1.2 &&
        item.y > BASKET_Y - 0.5 &&
        Math.abs(item.x - this.bx) < 2.1
      ) {
        item.y = -99;
        if (item.bomb) {
          this.explode();
          return;
        }
        this.catchApple();
      }
    }
    this.items = this.items.filter((item) => {
      if (item.y > -15) {
        return true;
      }
      item.image.destroy();
      item.spark?.destroy();
      return false;
    });

    if (hopon.score !== this.shownScore) {
      this.shownScore = hopon.score;
      this.scoreText
        .setText(String(hopon.score))
        .setVisible(true)
        .setScale(1.2);
      this.tweens.add({ duration: 150, scale: 1, targets: this.scoreText });
    }
  }

  private drop(y: number, score: number) {
    const bomb = Math.random() < Math.min(0.4, 0.2 + score * 0.005);
    const item: Item = {
      bomb,
      image: this.add.image(0, 0, bomb ? "bomb" : "apple").setDepth(5),
      v: 0.1 + Math.random() * 0.04 + Math.min(0.2, score * 0.004),
      x: PMath.FloatBetween(-UNITS_WIDE / 2 + 1, UNITS_WIDE / 2 - 1),
      y,
    };
    if (bomb) {
      item.spark = this.add.image(0, 0, "glow").setBlendMode("ADD").setDepth(6);
    }
    item.image.setPosition(this.toX(item.x), this.toY(item.y));
    this.items.push(item);
  }

  private catchApple() {
    hopon.addScore(1);
    const { x, y } = this.basket;
    this.juice.explode(16, x, y - 15);
    this.basket.setScale(1.12, 0.86);
    this.tweens.add({
      duration: 200,
      ease: "Back.easeOut",
      scaleX: 1,
      scaleY: 1,
      targets: this.basket,
    });
    const plus = this.add
      .text(x, y - 35, "+1", {
        color: "#fff6c8",
        fontFamily: FONT,
        fontSize: "24px",
        fontStyle: "bold",
        resolution: ZOOM,
        stroke: OUTLINE,
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(25);
    this.tweens.add({
      alpha: 0,
      duration: 600,
      onComplete: () => plus.destroy(),
      targets: plus,
      y: y - 80,
    });
  }

  private explode() {
    this.bombsCaught += 1;
    hopon.testVars.bombsCaught = this.bombsCaught;
    const { x, y } = this.basket;
    this.blast.explode(60, x, y - 10);
    this.cameras.main.shake(400, 0.015).flash(200, 255, 200, 120);
    this.basket.setTint(0x33_22_11).setTintMode(TintModes.MULTIPLY);
    hopon.gameOver();
  }
}
