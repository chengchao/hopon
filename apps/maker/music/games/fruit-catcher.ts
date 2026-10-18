hopon.title = "Fruit Catcher";
hopon.hint = "Drag to move the basket";
const P = 0.25,
  W = 20;
const ding = new Sound([0.5, 0, 900, 0.01, 0.05, 0.1, 0, 1, 0, 0, 300]);
const boom = new Sound([1, 0.1, 120, 0.02, 0.2, 0.4, 4, 2, -5]);
let BX = 0;
let BY = 0;
function px(x: number, y: number, w: number, h: number, c: Color) {
  drawRect(
    vec2(BX + (x + w / 2) * P, BY + (y + h / 2) * P),
    vec2(w * P, h * P),
    c
  );
}
class Basket extends EngineObject {
  constructor() {
    super(vec2(0, -11), vec2(3.5, 2), undefined, 0, CLEAR_WHITE);
    this.gravityScale = 0;
  }
  update() {
    if (mouseIsDown(0)) {
      this.pos.x = lerp(this.pos.x, mousePos.x, 0.4);
    }
    this.pos.x +=
      (keyIsDown("ArrowRight") ? 0.3 : 0) - (keyIsDown("ArrowLeft") ? 0.3 : 0);
    this.pos.x = clamp(this.pos.x, -8.5, 8.5);
  }
  render() {
    BX = this.pos.x - 1.75;
    BY = this.pos.y - 1;
    const x = 0;
    const y = 0;
    const b = rgb(0.6, 0.35, 0.15);
    const d = rgb(0.4, 0.22, 0.08);
    px(x, y, 14, 8, b);
    px(-1, 6, 16, 2, rgb(0.8, 0.55, 0.3));
    px(2, 1, 1, 5, d);
    px(6, 1, 1, 5, d);
    px(10, 1, 1, 5, d);
    px(0, 3, 14, 1, d);
  }
}
class Item extends EngineObject {
  bomb: boolean;
  constructor(bomb: boolean) {
    super(vec2(rand(-8.5, 8.5), 15), vec2(1.5, 1.5), undefined, 0, WHITE);
    this.bomb = bomb;
    this.gravityScale = 0;
    this.velocity = vec2(0, -0.07 - rand(0.05) - Math.min(time * 0.001, 0.1));
  }
  update() {
    super.update();
    if (
      Math.abs(this.pos.x - bk.pos.x) < 2.1 &&
      Math.abs(this.pos.y - bk.pos.y) < 1.5
    ) {
      this.destroy();
      if (this.bomb) {
        boom.play();
        new ParticleEmitter(
          this.pos,
          0,
          1,
          0.2,
          80,
          3.14,
          undefined,
          YELLOW,
          RED
        );
        hopon.gameOver();
      } else {
        ding.play();
        hopon.addScore(1);
      }
    } else if (this.pos.y < -14) {
      this.destroy();
      if (!this.bomb) {
        miss++;
        if (miss >= 3) {
          hopon.gameOver();
        }
      }
    }
  }
  render() {
    BX = this.pos.x - 1.5;
    BY = this.pos.y - 1.5;
    const x = 0;
    const y = 0;
    if (this.bomb) {
      px(x + 1, y, 4, 6, BLACK);
      px(x, y + 1, 6, 4, BLACK);
      px(x + 1, y + 3, 1, 1, GRAY);
      px(x + 3, y + 6, 1, 1, rgb(0.6, 0.4, 0.2));
      px(x + 4, y + 7, 1, 1, ORANGE);
    } else {
      const r = rgb(0.9, 0.1, 0.1);
      px(x + 1, y, 4, 6, r);
      px(x, y + 1, 6, 4, r);
      px(x + 1, y + 4, 1, 1, rgb(1, 0.6, 0.6));
      px(x + 3, y + 6, 1, 2, rgb(0.4, 0.25, 0.1));
      px(x + 4, y + 6, 2, 1, rgb(0.2, 0.7, 0.2));
    }
  }
}
let bk: Basket,
  miss = 0,
  nx = 0;
function gameInit() {
  setCameraPos(vec2(0, 0));
  bk = new Basket();
  nx = 0;
  miss = 0;
}
function gameUpdate() {
  setCameraScale(mainCanvasSize.x / W);
  if (time > nx) {
    nx = time + Math.max(0.4, 1 - time * 0.01);
    new Item(randBool(0.3));
  }
}
function gameRender() {
  drawRectGradient(cameraPos, vec2(100), rgb(0.4, 0.7, 1), rgb(0.8, 0.93, 1));
  drawRect(vec2(0, -13.5), vec2(30, 3), rgb(0.3, 0.6, 0.2));
}
function gameRenderPost() {
  drawTextScreen(
    `Misses ${miss}/3`,
    vec2(mainCanvasSize.x - 70, 25),
    16,
    WHITE,
    3,
    BLACK
  );
}
