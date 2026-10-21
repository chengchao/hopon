hopon.title = "Moon Cat";
hopon.hint = "Tap to jump";

const GY = -6;
const jumpS = new Sound([0.5, 0, 500, 0.01, 0.05, 0.1, 1, 2, 10]);
const pointS = new Sound([0.5, 0, 900, 0.01, 0.05, 0.1, 0, 1, 0, 0, 300]);
const crashS = new Sound([1, 0.1, 120, 0.02, 0.2, 0.4, 4, 2, -5]);

type Met = { x: number; y: number; r: number; landed: boolean };
let catY = GY + 0.6;
let catV = 0;
let mets: Met[] = [];
let stars: { x: number; y: number }[] = [];
let nextMet = 0;
let nextStar = 0;
let scrl = 0;
let t0 = 0;
let spd = 0.1;

function gameInit() {
  setCameraPos(vec2(0, 0));
  catY = GY + 0.6;
  catV = 0;
  mets = [];
  stars = [];
  nextMet = time + 1;
  nextStar = time + 2;
  t0 = time;
  scrl = 0;
}

function gameUpdate() {
  setCameraScale(mainCanvasSize.x / 20);
  const el = time - t0;
  spd = Math.min(0.2, 0.09 + el * 0.0008);
  scrl += spd;
  const onGround = catY <= GY + 0.6 + 0.001;
  if ((mouseWasPressed(0) || keyWasPressed("Space")) && onGround) {
    catV = 0.3;
    jumpS.play();
  }
  catV -= 0.017;
  catY += catV;
  if (catY < GY + 0.6) {
    catY = GY + 0.6;
    catV = 0;
  }
  if (time > nextMet) {
    nextMet = time + rand(1.1, 2) * Math.max(0.55, 1 - el * 0.01);
    mets.push({ x: rand(5, 11), y: 15, r: rand(0.6, 0.9), landed: false });
  }
  if (time > nextStar) {
    nextStar = time + rand(1.2, 2.4);
    stars.push({ x: 11, y: GY + rand(2.2, 3.6) });
  }
  const cat = vec2(-5, catY);
  for (const m of mets) {
    if (!m.landed) {
      m.y -= 0.22;
      m.x -= spd * 0.5;
      if (m.y <= GY + m.r * 0.6) {
        m.y = GY + m.r * 0.6;
        m.landed = true;
        new ParticleEmitter(vec2(m.x, GY), 0, 0.5, 0.1, 20, 3, undefined, GRAY, ORANGE);
      }
    } else m.x -= spd;
    if (cat.distance(vec2(m.x, m.y)) < m.r + 0.45) {
      crashS.play();
      new ParticleEmitter(cat, 0, 1, 0.3, 80, 3.14, undefined, ORANGE, RED);
      hopon.gameOver();
      return;
    }
  }
  for (const s of stars) {
    s.x -= spd;
    if (!s.y || cat.distance(vec2(s.x, s.y)) < 1.1) {
      if (s.y) {
        hopon.addScore(1);
        pointS.play();
      }
      s.y = 0;
    }
  }
  mets = mets.filter((m) => m.x > -12);
  stars = stars.filter((s) => s.x > -12 && s.y !== 0);
}

function gameRender() {
  drawRectGradient(cameraPos, vec2(100, 100), rgb(0.02, 0.02, 0.12), rgb(0.1, 0.06, 0.25));
  for (let i = 0; i < 50; i++) {
    const x = ((i * 13.7 - scrl * 0.3) % 22 + 22) % 22 - 11;
    const y = ((i * 7.1) % 20) - 8 + 2;
    drawRect(vec2(x, y), vec2(i % 3 ? 0.08 : 0.14), WHITE);
  }
  drawCircle(vec2(6, 9), 3, rgb(0.9, 0.9, 0.8, 0.15));
  drawRect(vec2(0, GY - 8), vec2(40, 16), rgb(0.45, 0.45, 0.5));
  drawRect(vec2(0, GY - 0.1), vec2(40, 0.2), rgb(0.6, 0.6, 0.65));
  for (let i = 0; i < 8; i++) {
    const x = ((i * 5.3 - scrl) % 40 + 40) % 40 - 20;
    drawEllipse(vec2(x, GY - 1.5 - (i % 3)), vec2(2.2, 0.7), rgb(0.33, 0.33, 0.38));
  }
}

function gameRenderPost() {
  for (const m of mets) {
    if (!m.landed) drawLine(vec2(m.x, m.y), vec2(m.x + 0.6, m.y + 2.5), 0.3, rgb(1, 0.5, 0.1, 0.5));
    drawCircle(vec2(m.x, m.y), m.r * 2, rgb(0.4, 0.3, 0.28));
    drawCircle(vec2(m.x - 0.15, m.y + 0.15), m.r, rgb(0.55, 0.4, 0.3));
  }
  for (const s of stars) {
    drawCircle(vec2(s.x, s.y), 1.8, rgb(1, 0.9, 0.2, 0.25));
    drawRegularPoly(vec2(s.x, s.y), vec2(0.9), 5, YELLOW);
  }
  if (hopon.state === "over") return;
  const p = vec2(-5, catY);
  const o = rgb(1, 0.55, 0.1);
  drawLine(p.add(vec2(-0.5, -0.1)), p.add(vec2(-1.2, 0.5 + Math.sin(time * 10) * 0.2)), 0.2, o);
  drawRect(p, vec2(1.1, 0.9), o);
  drawCircle(p.add(vec2(0.4, 0.5)), 0.8, o);
  drawPoly([vec2(0, 0), vec2(0.25, 0.5), vec2(0.5, 0)], o, 0, o, p.add(vec2(0.1, 0.8)));
  drawPoly([vec2(0, 0), vec2(0.25, 0.5), vec2(0.5, 0)], o, 0, o, p.add(vec2(0.5, 0.8)));
  drawCircle(p.add(vec2(0.65, 0.55)), 0.15, BLACK);
}
