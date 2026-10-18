hopon.title = "Moon Cat";
hopon.hint = "Tap to jump";
const GROUND = -7;
const jumpS = new Sound([0.5, 0, 500, 0.01, 0.05, 0.15, 1, 2, 10]);
const pickup = new Sound([0.5, 0, 1200, 0.01, 0.05, 0.15, 0, 1.5, 0, 0, 400]);
const boom = new Sound([1, 0.2, 80, 0.01, 0.3, 0.6, 4, 1, -2]);
let cat: Cat;
let nextSpawn = 0;
class Cat extends EngineObject {
  constructor() {
    super(
      vec2(-5, GROUND + 1),
      vec2(1.6, 1.4),
      undefined,
      0,
      hsl(0.08, 0.8, 0.6)
    );
    this.gravityScale = 1;
  }
  update() {
    const onGround = this.pos.y <= GROUND + 0.8;
    if ((mouseWasPressed(0) || keyWasPressed("Space")) && onGround) {
      this.velocity = vec2(0, 0.3);
      jumpS.play(this.pos);
    }
    super.update();
    if (this.pos.y < GROUND + 0.7) {
      this.pos.y = GROUND + 0.7;
      this.velocity = vec2(0, 0);
    }
  }
  render() {
    const p = this.pos;
    const c = this.color;
    drawEllipse(p, vec2(1.6, 1.1), c);
    drawCircle(p.add(vec2(0.7, 0.5)), 1, c);
    drawPoly([vec2(0.3, 0.9), vec2(0.5, 1.4), vec2(0.8, 1)], c, 0, c, p);
    drawPoly([vec2(0.8, 1), vec2(1.1, 1.4), vec2(1.2, 0.8)], c, 0, c, p);
    drawCircle(p.add(vec2(0.95, 0.6)), 0.2, BLACK);
    drawLine(
      p.add(vec2(-0.8, 0.1)),
      p.add(vec2(-1.4, 0.7 + Math.sin(time * 8) * 0.2)),
      0.2,
      c
    );
  }
}
class Faller extends EngineObject {
  star: boolean;
  constructor(star: boolean) {
    const y = star
      ? rand(GROUND + 1, GROUND + 6)
      : randBool(0.6)
        ? GROUND + 0.9
        : rand(GROUND + 2, GROUND + 5);
    super(
      vec2(12, y),
      vec2(star ? 1.1 : 1.3),
      undefined,
      0,
      star ? YELLOW : ORANGE
    );
    this.star = star;
    this.gravityScale = 0;
    this.velocity = vec2(-(0.12 + Math.min(time * 0.002, 0.1)), 0);
  }
  update() {
    super.update();
    this.angle += 0.08;
    if (this.pos.x < -12) {
      this.destroy();
    }
    if (this.pos.distance(cat.pos) < (this.star ? 1.2 : 1)) {
      this.destroy();
      if (this.star) {
        hopon.addScore(1);
        pickup.play(this.pos);
      } else {
        boom.play(this.pos);
        new ParticleEmitter(
          cat.pos,
          0,
          1,
          0.3,
          80,
          3.14,
          undefined,
          ORANGE,
          RED
        );
        hopon.gameOver();
      }
    }
  }
  render() {
    if (this.star) {
      drawRegularPoly(this.pos, 1.3, 5, YELLOW);
    } else {
      drawCircle(this.pos, 1.4, hsl(0.05, 0.5, 0.4));
      drawCircle(this.pos.add(vec2(0.9, 0)), 0.8, ORANGE);
    }
  }
}
function gameInit() {
  setCameraPos(vec2(0, 0));
  setGravity(vec2(0, -0.008));
  cat = new Cat();
  nextSpawn = 0;
}
function gameUpdate() {
  setCameraScale(mainCanvasSize.x / 20);
  if (time > nextSpawn) {
    nextSpawn = time + rand(0.7, 1.4);
    new Faller(randBool(0.4));
  }
}
function gameRender() {
  drawRectGradient(
    cameraPos,
    vec2(100),
    hsl(0.68, 0.6, 0.05),
    hsl(0.65, 0.5, 0.18)
  );
  for (let i = 0; i < 40; i++) {
    drawRect(
      vec2(((i * 13.7) % 20) - 10, ((i * 7.1) % 22) - 8),
      vec2(0.1),
      WHITE
    );
  }
  drawCircle(vec2(5, 9), 4, hsl(0.15, 0.2, 0.9));
  drawRect(vec2(0, GROUND - 3.5), vec2(30, 7), hsl(0, 0, 0.6));
  drawCircle(vec2(-3, GROUND - 1), 2, hsl(0, 0, 0.5));
  drawCircle(vec2(4, GROUND - 1.5), 2.5, hsl(0, 0, 0.5));
}
