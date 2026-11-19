import { AUTO, Game, Scene } from "phaser";

class Play extends Scene {
  frames = 0;

  create() {
    this.add.rectangle(180, 320, 80, 80, 0xff_cc_00);
    hopon.ready();
  }

  update() {
    this.frames += 1;
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
