# A Phaser game with several screens

Read this after `references/phaser.md`, for a game the player moves through: a map and a town, a field and a shop, a world and a battle. A game that plays on one screen has one scene and needs none of this.

## One scene for each screen

Each screen is a `Scene` subclass in its own file, with its own key. Never put two screens into one scene behind a flag such as `mode === "shop"`: every object of every screen then lives at once, each handler has to ask which screen is up, and the file grows past what you can keep right.

- **The state lives in `src/rules.ts`, not in a scene.** A scene is one view of the state. Leaving a screen destroys its scene's objects, and coming back runs its `create()` again, so everything that must outlast a screen (gold, the hold, where the player stands on the map) is in the run's state, and `create()` draws the screen from it.
- **`this.scene.start("shop")` goes to another screen.** It stops this scene and starts that one. To hand it something, pass data and read it in `init`: `this.scene.start("battle", { enemy: 2 })`, then `init(data: { enemy: number })`.
- **A scene switch happens at the next frame,** not on the line that asks for it. Return right after `this.scene.start(...)`, and don't read the other scene on the next line.
- **Every scene's `create()`** calls `makeTextures(this)` and `screen(this)` first, as a single scene does, and ends with `hopon.ready()`. Textures are shared by all scenes, so `makeTextures` still makes each once.
- **Every scene's `update`** runs the gameplay only while `hopon.state === "play"`, and sets `hopon.testVars`, with one value that names the screen, so a test can check where the player is.
- **A clock that runs on every screen,** such as a day counter or a round timer, is a rule in `src/rules.ts` that each scene's `update` calls with its `dt`.
- **Set a scene's own fields in `create()` or `init()`,** never in a field initializer or the constructor: the scene object is reused each time the screen comes back.
- **Listeners on the scene's own objects, input, tweens and timers go when the scene stops.** One you put on something that outlives the scene, such as `this.game.events` or `this.registry.events`, stays and stacks up each visit: take it off on `this.events.once("shutdown", ...)`.

## A new round

`src/main.tsx` lists every scene, and the first one starts with the game. When a round starts, it makes a new state, stops every other screen, and starts the first:

```ts
const game = new Game({
  // ...as in the Phaser guide
  scene: [Orchard, Stall],
});

let last = hopon.state;
hopon.subscribe(({ paused, state }) => {
  if (paused && !game.isPaused) {
    game.pause();
  } else if (!paused && game.isPaused) {
    game.resume();
  }
  if (state === "play" && last !== "play") {
    run.current = newRun();
    game.scene.stop("stall");
    game.scene.start("orchard");
  }
  last = state;
});
```

`game.scene.start` restarts a scene that is running, so the first screen is fresh too.

## A screen over another

A screen that covers the world for a moment and gives it back as it was, such as a short battle over the map, can run on top instead: `this.scene.launch("battle")` and `this.scene.pause()` in the map, then `this.scene.stop()` and `this.scene.resume("map")` in the battle. The map keeps its objects and stops updating while it is paused. Scenes draw in the order of the `scene` list, so list the one on top last. When a plain `start` in both directions does the job, use that: it has fewer ways to go wrong.

With React panels (`references/phaser-panels.md`), a shop or a menu of words and buttons can be a panel over one scene. A place with its own drawing is still a scene of its own, with its panel over it.

## Example: Apple Stall

Two screens. Pick apples from the tree, carry them to the stall, and sell them before the time runs out. Every file but the skeleton is below.

### `src/main.tsx`

```ts
import { AUTO, Game, Scale } from "phaser";

import { ZOOM } from "./art";
import { Orchard } from "./orchard";
import { newRun, run } from "./rules";
import { Stall } from "./stall";

hopon.title = "Apple Stall";
hopon.hint = "Pick apples, then sell them";

const game = new Game({
  backgroundColor: "#bfe6ff",
  parent: "root",
  scale: {
    height: window.innerHeight * ZOOM,
    mode: Scale.EXPAND,
    width: window.innerWidth * ZOOM,
  },
  scene: [Orchard, Stall],
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
    run.current = newRun();
    game.scene.stop("stall");
    game.scene.start("orchard");
  }
  last = state;
});
```

### `src/rules.ts`

```ts
export const ROUND_SECONDS = 30;
export const PRICE = 2;

export interface Run {
  apples: number;
  coins: number;
  timeLeft: number;
}

export const newRun = (): Run => ({
  apples: 0,
  coins: 0,
  timeLeft: ROUND_SECONDS,
});

// The round in play. main.tsx puts a new one here when a round starts.
export const run = { current: newRun() };

export const pick = (state: Run) => {
  state.apples += 1;
};

// Sells every apple, and says what they earned.
export const sell = (state: Run) => {
  const earned = state.apples * PRICE;
  state.coins += earned;
  state.apples = 0;
  return earned;
};

// The round's clock, which runs on both screens. True when the time is up.
export const tick = (state: Run, seconds: number) => {
  state.timeLeft = Math.max(0, state.timeLeft - seconds);
  return state.timeLeft === 0;
};

// What both screens show along the top.
export const status = (state: Run) =>
  `${state.apples} apples   ${state.coins} coins   ${Math.ceil(state.timeLeft)} s`;
```

### `src/orchard.ts`

```ts
import { Scene } from "phaser";
import type { GameObjects } from "phaser";

import { label, makeTextures, screen } from "./art";
import { pick, run, status, tick } from "./rules";
import { sfx } from "./sfx";

// Where the apples hang, from the foot of the tree.
const BRANCHES = [
  [-70, -250],
  [0, -290],
  [70, -250],
  [-35, -200],
  [40, -205],
];

export class Orchard extends Scene {
  private hud!: GameObjects.Text;

  constructor() {
    super("orchard");
  }

  create() {
    makeTextures(this);
    const { width, height } = screen(this);
    const ground = height - 150;
    this.add.image(0, 0, "sky").setOrigin(0).setDisplaySize(width, height);
    this.add.rectangle(0, ground, width, 150, 0x6bbf59).setOrigin(0);
    this.add.ellipse(width / 2, ground + 4, 150, 22, 0x000000, 0.2);
    this.add.image(width / 2, ground, "tree").setOrigin(0.5, 1);
    for (const [dx = 0, dy = 0] of BRANCHES) {
      const apple = this.add
        .image(width / 2 + dx, ground + dy, "apple")
        .setInteractive();
      apple.on("pointerdown", () => {
        if (hopon.state !== "play" || !apple.visible) {
          return;
        }
        pick(run.current);
        sfx.pick();
        apple.setVisible(false);
        // A new apple grows on the branch.
        this.time.delayedCall(1500, () => apple.setVisible(true));
      });
    }
    const stall = this.add.image(width / 2, height - 70, "button");
    label(this, width / 2, height - 70, "To the stall", 22);
    stall.setInteractive().on("pointerdown", () => {
      if (hopon.state === "play") {
        sfx.go();
        this.scene.start("stall");
      }
    });
    this.hud = label(this, width / 2, 50, "", 22);
    hopon.ready();
  }

  update(_time: number, delta: number) {
    const state = run.current;
    if (hopon.state === "play" && tick(state, Math.min(delta, 50) / 1000)) {
      sfx.end();
      hopon.gameOver();
    }
    const text = status(state);
    if (text !== this.hud.text) {
      this.hud.setText(text);
    }
    hopon.testVars.screen = "orchard";
    hopon.testVars.apples = state.apples;
    hopon.testVars.coins = state.coins;
    hopon.testVars.timeLeft = Math.round(state.timeLeft * 10) / 10;
  }
}
```

### `src/stall.ts`

```ts
import { Scene } from "phaser";
import type { GameObjects } from "phaser";

import { label, makeTextures, screen } from "./art";
import { run, sell, status, tick } from "./rules";
import { sfx } from "./sfx";

export class Stall extends Scene {
  private hud!: GameObjects.Text;

  constructor() {
    super("stall");
  }

  create() {
    makeTextures(this);
    const { width, height } = screen(this);
    this.add.image(0, 0, "sky").setOrigin(0).setDisplaySize(width, height);
    this.add.rectangle(0, height - 150, width, 150, 0xd9a066).setOrigin(0);
    this.add.image(width / 2, height - 150, "stall").setOrigin(0.5, 1);
    const sellButton = this.add.image(width / 2, 300, "button");
    label(this, width / 2, 300, "Sell the apples", 22);
    sellButton.setInteractive().on("pointerdown", () => {
      if (hopon.state !== "play") {
        return;
      }
      const earned = sell(run.current);
      if (earned > 0) {
        hopon.addScore(earned);
        sfx.coin();
      }
    });
    const back = this.add.image(width / 2, height - 70, "button");
    label(this, width / 2, height - 70, "To the tree", 22);
    back.setInteractive().on("pointerdown", () => {
      if (hopon.state === "play") {
        sfx.go();
        this.scene.start("orchard");
      }
    });
    this.hud = label(this, width / 2, 50, "", 22);
    hopon.ready();
  }

  update(_time: number, delta: number) {
    const state = run.current;
    if (hopon.state === "play" && tick(state, Math.min(delta, 50) / 1000)) {
      sfx.end();
      hopon.gameOver();
    }
    const text = status(state);
    if (text !== this.hud.text) {
      this.hud.setText(text);
    }
    hopon.testVars.screen = "stall";
    hopon.testVars.apples = state.apples;
    hopon.testVars.coins = state.coins;
    hopon.testVars.timeLeft = Math.round(state.timeLeft * 10) / 10;
  }
}
```

### `src/sfx.ts`

```ts
export const sfx = {
  coin: () => {
    hopon.play({ freq: 990, ms: 70, volume: 0.2 });
    hopon.play({ delayMs: 70, freq: 1320, ms: 140, volume: 0.2 });
  },
  end: () =>
    hopon.play({ freq: 440, ms: 700, to: 110, volume: 0.3, wave: "sawtooth" }),
  go: () => hopon.play({ freq: 520, ms: 50, volume: 0.15, wave: "triangle" }),
  pick: () => hopon.play({ freq: 280, ms: 160, to: 620, volume: 0.2 }),
};
```

### `src/art.ts`

```ts
import type { Scene } from "phaser";

export const ZOOM = Math.min(window.devicePixelRatio, 2);
const INK = "#3b2416";
const FONT = "system-ui, -apple-system, Roboto, sans-serif";

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

export const label = (
  scene: Scene,
  x: number,
  y: number,
  text: string,
  size: number
) =>
  scene.add
    .text(x, y, text, {
      color: "#ffffff",
      fontFamily: FONT,
      fontSize: `${size}px`,
      fontStyle: "bold",
      resolution: ZOOM,
      stroke: INK,
      strokeThickness: 5,
    })
    .setOrigin(0.5)
    .setDepth(30);

// Every scene calls this, and the textures, shared by all scenes, are made once.
export const makeTextures = (scene: Scene) => {
  if (scene.textures.exists("sky")) {
    return;
  }
  texture(scene, "sky", 2, 256, (ctx) => {
    const sky = ctx.createLinearGradient(0, 0, 0, 256);
    sky.addColorStop(0, "#7cc6ff");
    sky.addColorStop(1, "#e8f7ff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 2, 256);
  });
  texture(scene, "tree", 240, 340, (ctx) => {
    ctx.fillStyle = INK;
    ctx.fillRect(101, 190, 38, 150);
    ctx.fillStyle = "#8a5a33";
    ctx.fillRect(105, 190, 30, 150);
    for (const [x, y, r] of [
      [120, 120, 112],
      [62, 165, 60],
      [178, 165, 60],
    ]) {
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(x ?? 0, y ?? 0, r ?? 0, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const [x, y, r, colour] of [
      [120, 120, 108, "#3f9b4b"],
      [62, 165, 56, "#3f9b4b"],
      [178, 165, 56, "#3f9b4b"],
      [95, 90, 60, "#5cc267"],
    ] as const) {
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  // 48 px across, so the apple is easy to tap.
  texture(scene, "apple", 48, 48, (ctx) => {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(24, 27, 17, 0, Math.PI * 2);
    ctx.fill();
    const body = ctx.createRadialGradient(19, 21, 2, 24, 27, 15);
    body.addColorStop(0, "#ff8f8f");
    body.addColorStop(0.5, "#e02633");
    body.addColorStop(1, "#a3121f");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(24, 27, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#5cc267";
    ctx.beginPath();
    ctx.ellipse(30, 9, 7, 4, -0.5, 0, Math.PI * 2);
    ctx.fill();
  });
  texture(scene, "stall", 260, 220, (ctx) => {
    ctx.fillStyle = INK;
    ctx.fillRect(18, 60, 224, 160);
    ctx.fillStyle = "#c98b4f";
    ctx.fillRect(22, 64, 216, 156);
    ctx.fillStyle = "#a86f3a";
    ctx.fillRect(22, 150, 216, 70);
    for (let stripe = 0; stripe < 8; stripe += 1) {
      ctx.fillStyle = stripe % 2 === 0 ? "#e02633" : "#fff4e0";
      ctx.beginPath();
      ctx.moveTo(10 + stripe * 30, 0);
      ctx.lineTo(40 + stripe * 30, 0);
      ctx.lineTo(40 + stripe * 30, 60);
      ctx.arc(25 + stripe * 30, 60, 15, 0, Math.PI);
      ctx.lineTo(10 + stripe * 30, 0);
      ctx.fill();
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 0, 240, 60);
  });
  texture(scene, "button", 250, 60, (ctx) => {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.roundRect(0, 0, 250, 60, 16);
    ctx.fill();
    ctx.fillStyle = "#ffb84d";
    ctx.beginPath();
    ctx.roundRect(4, 4, 242, 48, 13);
    ctx.fill();
  });
};
```

### `tests.json`

```json
{
  "expose": [
    {
      "name": "screen",
      "means": "the screen the player is on: \"orchard\" or \"stall\""
    },
    { "name": "apples", "means": "how many apples the player carries" },
    { "name": "coins", "means": "how many coins the player has" },
    { "name": "timeLeft", "means": "the seconds left in the round" }
  ],
  "tests": [
    {
      "name": "an apple picked from the tree sells at the stall for coins",
      "inputs": [
        { "at": 400, "type": "tap", "x": 180, "y": 200 },
        { "at": 900, "type": "tap", "x": 180, "y": 570 },
        { "at": 1500, "type": "tap", "x": 180, "y": 300 }
      ],
      "checks": [
        {
          "at": 700,
          "expect": "vars.screen === 'orchard' && vars.apples === 1"
        },
        {
          "at": 1300,
          "expect": "vars.screen === 'stall' && vars.apples === 1"
        },
        {
          "at": 1900,
          "expect": "vars.apples === 0 && vars.coins === 2 && score === 2"
        }
      ]
    },
    {
      "name": "the way back from the stall leads to the tree",
      "inputs": [
        { "at": 400, "type": "tap", "x": 180, "y": 570 },
        { "at": 1100, "type": "tap", "x": 180, "y": 570 }
      ],
      "checks": [
        { "at": 900, "expect": "vars.screen === 'stall'" },
        {
          "at": 1600,
          "expect": "vars.screen === 'orchard' && state === 'play'"
        }
      ]
    },
    {
      "name": "the round's clock stops while the feed has the game paused",
      "inputs": [
        { "at": 600, "type": "pause" },
        { "at": 1600, "type": "resume" }
      ],
      "checks": [
        { "at": 500, "expect": "vars.timeLeft < 30" },
        { "at": 700, "expect": "vars.timeLeft < 30" },
        { "at": 1500, "expect": "vars.timeLeft === prev.vars.timeLeft" },
        { "at": 2200, "expect": "vars.timeLeft < prev.vars.timeLeft" }
      ]
    }
  ]
}
```
