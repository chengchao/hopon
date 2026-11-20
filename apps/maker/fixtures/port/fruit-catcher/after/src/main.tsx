import { AUTO, Game, Scale } from "phaser";

import { ZOOM } from "./art";
import { Catch } from "./catch";

hopon.hint = "Drag to move the basket";

const game = new Game({
  backgroundColor: "#5ebaed",
  parent: "root",
  scale: {
    height: window.innerHeight * ZOOM,
    mode: Scale.EXPAND,
    width: window.innerWidth * ZOOM,
  },
  scene: Catch,
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
    game.scene.getScene("catch")?.scene.restart();
  }
  last = state;
});
