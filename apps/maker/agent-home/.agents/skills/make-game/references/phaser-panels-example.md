# A Phaser game with React panels

A whole game that follows `references/phaser-panels.md`. Build your own game from its patterns, never a copy of it.

## Example: Spice Run

A trading game. The scene is a sea with three ports and a ship; tap a port to sail there. React is the HUD and the market that opens in port, where spice is bought and sold. Every file but the skeleton and `src/panels.tsx` is below.

### `src/main.tsx`

```tsx
import { AUTO, Game, Scale } from "phaser";

import { ZOOM } from "./art";
import { Market } from "./Market";
import { showPanels } from "./panels";
import { Play } from "./play";
import "./style.css";

hopon.title = "Spice Run";
hopon.hint = "Buy low, sail, sell high";

const game = new Game({
  backgroundColor: "#0b3c5d",
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

showPanels(<Market />);
```

### `src/Market.tsx`

```tsx
import { useEffect, useState } from "react";

import { emit, useEvent } from "./panels";
import {
  DAYS,
  GOAL,
  HOLD,
  PORTS,
  buy,
  dock,
  newTrade,
  roll,
  sail,
  sell,
} from "./rules";
import type { Trade } from "./rules";

export const Market = () => {
  const [trade, setTrade] = useState(newTrade);

  useEvent("sailing", () => setTrade(sail(trade)));
  useEvent("docked", (port: number) => setTrade(dock(trade, port, roll(port))));

  useEffect(() => {
    if (trade.over) {
      hopon.addScore(trade.gold);
      hopon.gameOver(trade.gold >= GOAL);
    }
  }, [trade.over, trade.gold]);

  const press = (next: Trade, gold: number) => {
    if (next !== trade) {
      emit("traded", gold);
      setTrade(next);
    }
  };

  Object.assign(hopon.testVars, {
    cargo: trade.cargo,
    days: trade.days,
    docked: trade.docked,
    gold: trade.gold,
    port: trade.port,
  });
  return (
    <>
      <header className="hud">
        <span className="chip">
          <i className="coin" />
          {trade.gold}
        </span>
        <span className="chip">
          Hold {trade.cargo}/{HOLD}
        </span>
        <span className="chip">
          Day {DAYS - trade.days + 1}/{DAYS}
        </span>
      </header>
      {trade.docked && !trade.over && (
        <section className="sheet" key={trade.port}>
          <h2>{PORTS[trade.port].name}</h2>
          <p>
            Spice is <b>{trade.price}</b> gold here. Tap another port to sail.
            Reach {GOAL} gold.
          </p>
          <div className="row">
            <button
              disabled={trade.cargo >= HOLD || trade.gold < trade.price}
              onPointerDown={() => press(buy(trade), -trade.price)}
              type="button"
            >
              Buy 1
            </button>
            <button
              className="sell"
              disabled={trade.cargo === 0}
              onPointerDown={() => press(sell(trade), trade.price)}
              type="button"
            >
              Sell 1
            </button>
          </div>
        </section>
      )}
    </>
  );
};
```

### `src/rules.ts`

```ts
// The trading rules: plain data and pure functions, with no React and no Phaser, so the UI and the scene share them.
export const PORTS = [
  { high: 7, low: 4, name: "Saffron Bay", x: 0.22, y: 0.5 },
  { high: 12, low: 8, name: "Port Clove", x: 0.76, y: 0.37 },
  { high: 18, low: 13, name: "Cinder Isle", x: 0.4, y: 0.17 },
];
export const HOLD = 5;
export const GOAL = 150;
export const DAYS = 8;

export interface Trade {
  cargo: number;
  days: number;
  docked: boolean;
  gold: number;
  over: boolean;
  port: number;
  price: number;
}

export const roll = (port: number) => {
  const { high, low } = PORTS[port];
  return low + Math.floor(Math.random() * (high - low + 1));
};

export const newTrade = (): Trade => ({
  cargo: 0,
  days: DAYS,
  docked: true,
  gold: 30,
  over: false,
  port: 0,
  price: PORTS[0].low,
});

export const buy = (trade: Trade): Trade =>
  trade.docked && !trade.over && trade.cargo < HOLD && trade.gold >= trade.price
    ? { ...trade, cargo: trade.cargo + 1, gold: trade.gold - trade.price }
    : trade;

export const sell = (trade: Trade): Trade => {
  if (!trade.docked || trade.over || trade.cargo === 0) {
    return trade;
  }
  const gold = trade.gold + trade.price;
  return { ...trade, cargo: trade.cargo - 1, gold, over: gold >= GOAL };
};

export const sail = (trade: Trade): Trade => ({ ...trade, docked: false });

// A day passes at sea. On the last day the hold is sold where the ship lands, and the round ends.
export const dock = (trade: Trade, port: number, price: number): Trade => {
  const days = trade.days - 1;
  const landed = { ...trade, days, docked: true, port, price };
  return days > 0
    ? landed
    : {
        ...landed,
        cargo: 0,
        gold: trade.gold + trade.cargo * price,
        over: true,
      };
};
```

### `src/play.ts`

```ts
import { Scene } from "phaser";
import type { GameObjects, Input } from "phaser";

import { FONT, INK, ZOOM, makeTextures, screen } from "./art";
import { emit, listen } from "./panels";
import { PORTS } from "./rules";

const SPEED = 150;
const REACH = 46;
const BERTH = 38;

export class Play extends Scene {
  private boat!: GameObjects.Image;
  private waves!: GameObjects.TileSprite;
  private wake!: GameObjects.Particles.ParticleEmitter;
  private coins!: GameObjects.Particles.ParticleEmitter;
  private spots: { x: number; y: number }[] = [];
  private at = { x: 0, y: 0 };
  private port = 0;
  private target = -1;
  private sailed = 0;
  private untilWake = 0;

  constructor() {
    super("play");
  }

  create() {
    makeTextures(this);
    const { width: w, height: h } = screen(this);
    this.port = 0;
    this.target = -1;
    this.sailed = 0;
    this.untilWake = 0;
    this.spots = PORTS.map((port) => ({ x: port.x * w, y: port.y * h }));
    this.at = { x: this.spots[0].x, y: this.spots[0].y + BERTH };

    this.add.image(0, 0, "sea").setOrigin(0).setDisplaySize(w, h);
    this.waves = this.add
      .tileSprite(0, 0, w, h, "waves")
      .setOrigin(0)
      .setAlpha(0.35);
    for (const [index, spot] of this.spots.entries()) {
      this.add
        .image(spot.x, spot.y, "glow")
        .setScale(2.2)
        .setAlpha(0.25)
        .setBlendMode("ADD");
      const island = this.add.image(spot.x, spot.y, "island").setDepth(5);
      this.tweens.add({
        delay: index * 300,
        duration: 1600,
        ease: "Sine.easeInOut",
        repeat: -1,
        scaleY: 1.04,
        targets: island,
        yoyo: true,
      });
      this.add
        .text(spot.x, spot.y - 40, PORTS[index].name, {
          color: "#ffffff",
          fontFamily: FONT,
          fontSize: "15px",
          fontStyle: "bold",
          resolution: ZOOM,
          stroke: INK,
          strokeThickness: 5,
        })
        .setOrigin(0.5)
        .setDepth(30);
    }
    this.wake = this.add
      .particles(0, 0, "dot", {
        alpha: { end: 0, start: 0.7 },
        emitting: false,
        lifespan: 700,
        scale: { end: 1.6, start: 0.5 },
        speed: { max: 14, min: 4 },
      })
      .setDepth(8);
    this.coins = this.add
      .particles(0, 0, "dot", {
        blendMode: "ADD",
        emitting: false,
        gravityY: 300,
        lifespan: 600,
        scale: { end: 0, start: 1 },
        speed: { max: 200, min: 80 },
        tint: 0xff_d1_66,
      })
      .setDepth(20);
    this.boat = this.add
      .image(this.at.x, this.at.y, "boat")
      .setOrigin(0.5, 0.8)
      .setDepth(10);

    this.input.on("pointerdown", (pointer: Input.Pointer) => {
      this.sailTo(pointer.worldX, pointer.worldY);
    });
    listen(this, "traded", (gold: number) => this.showTrade(gold));
    hopon.ready();
  }

  update(_time: number, delta: number) {
    if (hopon.state === "over") {
      return;
    }
    const dt = Math.min(delta, 50) / 1000;
    this.waves.tilePositionX += 10 * dt;
    this.waves.tilePositionY += 4 * dt;
    if (hopon.state === "play" && this.target >= 0) {
      this.sail(dt);
    }
    this.boat.setPosition(
      this.at.x,
      this.at.y + Math.sin(this.time.now / 300) * 2
    );
    hopon.testVars.sailed = Math.round(this.sailed);
  }

  private sailTo(x: number, y: number) {
    if (hopon.state !== "play" || this.target >= 0) {
      return;
    }
    const to = this.spots.findIndex(
      (spot) => Math.hypot(spot.x - x, spot.y - y) < REACH
    );
    if (to < 0 || to === this.port) {
      return;
    }
    this.target = to;
    this.boat.setFlipX(this.spots[to].x < this.at.x);
    emit("sailing");
  }

  private sail(dt: number) {
    const goal = this.spots[this.target];
    const dx = goal.x - this.at.x;
    const dy = goal.y + BERTH - this.at.y;
    const left = Math.hypot(dx, dy);
    const step = Math.min(left, SPEED * dt);
    if (left > 0) {
      this.at.x += (dx / left) * step;
      this.at.y += (dy / left) * step;
    }
    this.sailed += step;
    this.boat.angle = Math.sin(this.time.now / 180) * 4;
    this.untilWake -= dt;
    if (this.untilWake <= 0) {
      this.untilWake = 0.08;
      this.wake.explode(1, this.at.x, this.at.y + 4);
    }
    if (left - step > 0.5) {
      return;
    }
    this.port = this.target;
    this.target = -1;
    this.boat.setAngle(0).setScale(1.2, 0.85);
    this.tweens.add({
      duration: 220,
      ease: "Back.easeOut",
      scaleX: 1,
      scaleY: 1,
      targets: this.boat,
    });
    emit("docked", this.port);
  }

  private showTrade(gold: number) {
    const spot = this.spots[this.port];
    if (gold > 0) {
      this.coins.explode(12, spot.x, spot.y);
    }
    const label = this.add
      .text(spot.x, spot.y - 10, `${gold > 0 ? "+" : ""}${gold}`, {
        color: gold > 0 ? "#ffd166" : "#ffb4a2",
        fontFamily: FONT,
        fontSize: "24px",
        fontStyle: "bold",
        resolution: ZOOM,
        stroke: INK,
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(30);
    this.tweens.add({
      alpha: 0,
      duration: 700,
      ease: "Cubic.easeOut",
      onComplete: () => label.destroy(),
      targets: label,
      y: spot.y - 60,
    });
  }
}
```

### `src/art.ts`

```ts
import type { Scene } from "phaser";

export const ZOOM = Math.min(window.devicePixelRatio, 2);
export const INK = "#2b1b12";
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

const oval = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: string
) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
};

const shape = (
  ctx: CanvasRenderingContext2D,
  points: [number, number][],
  color: string
) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (const [x, y] of points) {
    ctx.lineTo(x, y);
  }
  ctx.fill();
};

export const makeTextures = (scene: Scene) => {
  if (scene.textures.exists("sea")) {
    return;
  }
  texture(scene, "sea", 2, 256, (ctx) => {
    const sea = ctx.createLinearGradient(0, 0, 0, 256);
    sea.addColorStop(0, "#1fa4b6");
    sea.addColorStop(0.6, "#147a9c");
    sea.addColorStop(1, "#0b3c5d");
    ctx.fillStyle = sea;
    ctx.fillRect(0, 0, 2, 256);
  });
  texture(scene, "waves", 64, 32, (ctx) => {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    for (const [x, y] of [
      [6, 9],
      [38, 25],
    ]) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 5, y - 5, x + 10, y);
      ctx.quadraticCurveTo(x + 15, y + 5, x + 20, y);
      ctx.stroke();
    }
  });
  texture(scene, "glow", 64, 64, (ctx) => {
    const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    glow.addColorStop(0, "rgba(255,255,255,1)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 64, 64);
  });
  texture(scene, "island", 88, 62, (ctx) => {
    oval(ctx, 44, 44, 43, 17, INK);
    oval(ctx, 44, 43, 40, 14, "#f2d59b");
    oval(ctx, 44, 47, 34, 8, "#e0b872");
    oval(ctx, 38, 29, 27, 19, INK);
    oval(ctx, 38, 29, 24, 16, "#58b368");
    oval(ctx, 32, 23, 11, 6, "#8bd48f");
    oval(ctx, 44, 37, 14, 5, "#3f8f52");
    ctx.fillStyle = INK;
    ctx.fillRect(56, 26, 20, 17);
    ctx.fillStyle = "#fff3d6";
    ctx.fillRect(59, 31, 14, 9);
    shape(
      ctx,
      [
        [53, 31],
        [66, 18],
        [79, 31],
      ],
      INK
    );
    shape(
      ctx,
      [
        [58, 29],
        [66, 22],
        [74, 29],
      ],
      "#e4572e"
    );
  });
  texture(scene, "boat", 46, 44, (ctx) => {
    shape(
      ctx,
      [
        [1, 27],
        [45, 27],
        [38, 43],
        [8, 43],
      ],
      INK
    );
    shape(
      ctx,
      [
        [5, 30],
        [41, 30],
        [36, 40],
        [10, 40],
      ],
      "#9c5a2c"
    );
    ctx.fillStyle = "#c98244";
    ctx.fillRect(6, 30, 34, 3);
    ctx.fillStyle = INK;
    ctx.fillRect(20, 2, 4, 27);
    shape(
      ctx,
      [
        [24, 2],
        [44, 25],
        [24, 25],
      ],
      INK
    );
    shape(
      ctx,
      [
        [26, 8],
        [39, 23],
        [26, 23],
      ],
      "#fff7e6"
    );
    shape(
      ctx,
      [
        [26, 17],
        [39, 23],
        [26, 23],
      ],
      "#e8d9b0"
    );
    shape(
      ctx,
      [
        [20, 6],
        [5, 24],
        [20, 24],
      ],
      INK
    );
    shape(
      ctx,
      [
        [18, 11],
        [9, 22],
        [18, 22],
      ],
      "#e4572e"
    );
  });
  texture(scene, "dot", 8, 8, (ctx) => oval(ctx, 4, 4, 4, 4, "#ffffff"));
};
```

### `src/style.css`

```css
body {
  font-family:
    system-ui,
    -apple-system,
    Roboto,
    sans-serif;
  color: #2b1b12;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}
.hud {
  display: flex;
  justify-content: center;
  gap: 8px;
  padding-top: 14px;
}
.chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 3px solid #2b1b12;
  border-radius: 999px;
  background: #fff3d6;
  font-size: 16px;
  font-weight: 800;
}
.coin {
  width: 14px;
  height: 14px;
  border: 2px solid #2b1b12;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #fff3c4, #f2a541);
}
.sheet {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  box-sizing: border-box;
  padding: 14px 16px 16px;
  border: 3px solid #2b1b12;
  border-radius: 20px;
  background: linear-gradient(#fff8e7, #f6e2b3);
  box-shadow: 0 6px 0 rgba(0, 0, 0, 0.3);
  pointer-events: auto;
  animation: rise 220ms ease-out;
}
.sheet h2 {
  margin: 0 0 4px;
  font-size: 22px;
}
.sheet p {
  margin: 0 0 12px;
  font-size: 15px;
  line-height: 1.35;
}
.row {
  display: flex;
  gap: 12px;
}
.row button {
  flex: 1;
  height: 56px;
  border: 3px solid #2b1b12;
  border-radius: 14px;
  background: #58b368;
  box-shadow: 0 4px 0 #2b1b12;
  color: #fff;
  font: inherit;
  font-size: 19px;
  font-weight: 800;
}
.row button.sell {
  background: #e4572e;
}
.row button:active {
  transform: translateY(3px);
  box-shadow: 0 1px 0 #2b1b12;
}
.row button:disabled {
  background: #b9ae9a;
  color: #efe8da;
}
@keyframes rise {
  from {
    transform: translateY(30px);
    opacity: 0;
  }
}
```

### `tests.json`

```json
{
  "expose": [
    { "name": "gold", "means": "the gold the trader holds" },
    { "name": "cargo", "means": "crates of spice in the hold, 0 to 5" },
    { "name": "days", "means": "days left to sail, 8 at the start" },
    {
      "name": "port",
      "means": "the port the ship is at or last left: 0, 1 or 2"
    },
    {
      "name": "docked",
      "means": "true while the ship is in port and the market is open"
    },
    {
      "name": "sailed",
      "means": "how far the ship has sailed this round, in px"
    }
  ],
  "tests": [
    {
      "name": "the Buy button fills the hold and spends gold, and the ship stays in port",
      "inputs": [{ "at": 600, "type": "tap", "x": 101, "y": 584 }],
      "checks": [
        { "at": 500, "expect": "vars.cargo === 0 && vars.gold === 30" },
        {
          "at": 900,
          "expect": "vars.cargo === 1 && vars.gold < 30 && vars.docked === true && vars.sailed === 0"
        }
      ]
    },
    {
      "name": "a tap on another port sails there, costs a day and opens its market",
      "inputs": [{ "at": 600, "type": "tap", "x": 274, "y": 237 }],
      "checks": [
        { "at": 500, "expect": "vars.port === 0 && vars.docked === true" },
        { "at": 1200, "expect": "vars.docked === false && vars.sailed > 0" },
        {
          "at": 3000,
          "expect": "vars.port === 1 && vars.docked === true && vars.days === 7 && state === 'play'"
        }
      ]
    },
    {
      "name": "the ship stops while the feed has the game paused",
      "inputs": [
        { "at": 600, "type": "tap", "x": 274, "y": 237 },
        { "at": 900, "type": "pause" },
        { "at": 1700, "type": "resume" }
      ],
      "checks": [
        { "at": 800, "expect": "vars.sailed > 0" },
        { "at": 1000, "expect": "vars.sailed > 0" },
        { "at": 1600, "expect": "vars.sailed === prev.vars.sailed" },
        { "at": 2000, "expect": "vars.sailed > prev.vars.sailed" }
      ]
    }
  ]
}
```
