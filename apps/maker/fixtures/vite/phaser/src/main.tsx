import { AUTO, Game, Scene } from "phaser";
import type { GameObjects } from "phaser";

class Play extends Scene {
  frames = 0;
  box?: GameObjects.Rectangle;

  create() {
    this.box = this.add.rectangle(180, 320, 80, 80, 0xff_cc_00);
    hopon.testVars.taps = 0;
    this.input.on("pointerdown", () => {
      if (hopon.state === "play") {
        hopon.testVars.taps = Number(hopon.testVars.taps) + 1;
      }
    });
    hopon.ready();
  }

  update() {
    this.frames += 1;
    this.box?.setAngle(this.frames);
    hopon.testVars.frames = this.frames;
  }
}

export const game = new Game({
  backgroundColor: "#123",
  height: 640,
  parent: "root",
  scene: Play,
  type: AUTO,
  width: 360,
});

const follow = ({ paused }: Hopon) => {
  if (paused && !game.isPaused) {
    game.pause();
  } else if (!paused && game.isPaused) {
    game.resume();
  }
};
follow(hopon);
hopon.subscribe(follow);
