
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
    super(vec2(-5, GROUND + 1), vec2(1.6, 1.4), undefined, 0, hsl(0.08, 0.8, 0.6));
    this.gravityScale = 1;
  }
  update() {
    const onGround = this.pos.y <= GROUND + 0.8;
    if ((mouseWasPressed(0) || keyWasPressed("Space")) && onGround) {
      this.velocity = vec2(0, 0.3);
      jumpS.play(this.pos);
    }
    super.update();
    if (this.pos.y < GROUND + 0.7) { this.pos.y = GROUND + 0.7; this.velocity = vec2(0, 0); }
  }
  render() {
    const p = this.pos, c = this.color;
    drawEllipse(p, vec2(1.6, 1.1), c);
    drawCircle(p.add(vec2(0.7, 0.5)), 1, c);
    drawPoly([vec2(0.3, 0.9), vec2(0.5, 1.4), vec2(0.8, 1)], c, 0, c, p);
    drawPoly([vec2(0.8, 1), vec2(1.1, 1.4), vec2(1.2, 0.8)], c, 0, c, p);
    drawCircle(p.add(vec2(0.95, 0.6)), 0.2, BLACK);
    drawLine(p.add(vec2(-0.8, 0.1)), p.add(vec2(-1.4, 0.7 + Math.sin(time * 8) * 0.2)), 0.2, c);
  }
}
class Faller extends EngineObject {
  star: boolean;
  constructor(star: boolean) {
    const y = star ? rand(GROUND + 1, GROUND + 6) : (randBool(0.6) ? GROUND + 0.9 : rand(GROUND + 2, GROUND + 5));
    super(vec2(12, y), vec2(star ? 1.1 : 1.3), undefined, 0, star ? YELLOW : ORANGE);
    this.star = star;
    this.gravityScale = 0;
    this.velocity = vec2(-(0.12 + Math.min(time * 0.002, 0.1)), 0);
  }
  update() {
    super.update();
    this.angle += 0.08;
    if (this.pos.x < -12) this.destroy();
    if (this.pos.distance(cat.pos) < (this.star ? 1.2 : 1.0)) {
      this.destroy();
      if (this.star) { hopon.addScore(1); pickup.play(this.pos); }
      else {
        boom.play(this.pos);
        new ParticleEmitter(cat.pos, 0, 1, 0.3, 80, 3.14, undefined, ORANGE, RED);
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
  drawRectGradient(cameraPos, vec2(100), hsl(0.68, 0.6, 0.05), hsl(0.65, 0.5, 0.18));
  for (let i = 0; i < 40; i++) drawRect(vec2(((i * 13.7) % 20) - 10, ((i * 7.1) % 22) - 8), vec2(0.1), WHITE);
  drawCircle(vec2(5, 9), 4, hsl(0.15, 0.2, 0.9));
  drawRect(vec2(0, GROUND - 3.5), vec2(30, 7), hsl(0, 0, 0.6));
  drawCircle(vec2(-3, GROUND - 1), 2, hsl(0, 0, 0.5));
  drawCircle(vec2(4, GROUND - 1.5), 2.5, hsl(0, 0, 0.5));
}

const PADM = [0.3, 0, 207, 0.5, 0.9, 1, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0.2];
const ARPM = [0.18, 0, 440, 0.005, 0.05, 0.4, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0.4, 0.5, 0.1];
const BASSM = [0.7, 0, 41, 0.05, 0.4, 0.5, 2, 0.5];
const LEADM = [0.25, 0, 440, 0.1, 0.3, 0.5, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0.05, 0.15, 0.7, 0.1, 0.2, 0.5];
const row = (a: number[]) => { const r: number[] = []; for (let i = 0; i < 32; i++) r.push(0); a.forEach((n, i) => { if (n) r[i * 4] = n; }); return r; };
const pad = (a: number, b: number) => { const r = row([a]); r[16] = b; return r; };
const arp = (x: number[], y: number[]) => { const r: number[] = []; for (let i = 0; i < 32; i++) r.push((i % 2 ? 0 : (i < 16 ? x : y)[(i / 2) % 4 | 0] + 12 * 0) as number); return r; };
const bass = (a: number, b: number) => { const r = row([]); r[0] = a; r[8] = a; r[16] = b; r[24] = b; return r; };
const AMF = arp([12, 19, 24, 19], [8, 15, 20, 15]);
const CG = arp([15, 19, 24, 19], [10, 14, 17, 14]);
const lead1 = row([31, 0, 30, 0, 27, 0, 0, 0]);
const lead2 = row([29, 0, 0, 28, 0, 0, 24, 0]);
hopon.music = [
  [PADM, ARPM, BASSM, LEADM],
  [
    [[0, -0.4, ...pad(12, 8)], [1, 0.4, ...AMF], [2, 0, ...bass(0, -4 + 12 - 12 + 8)], [3, 0.2, ...row([])]],
    [[0, -0.4, ...pad(15, 10)], [1, 0.4, ...CG], [2, 0, ...bass(3, 10 - 12)], [3, 0.2, ...row([])]],
    [[0, -0.4, ...pad(12, 8)], [1, 0.4, ...AMF], [2, 0, ...bass(0, 8 - 12 + 12 - 0 - 12 + 0)], [3, 0.2, ...lead1]],
    [[0, -0.4, ...pad(15, 10)], [1, 0.4, ...CG], [2, 0, ...bass(3, 10 - 12)], [3, 0.2, ...lead2]],
  ],
  [0, 1, 2, 3, 2, 3],
  72,
];
