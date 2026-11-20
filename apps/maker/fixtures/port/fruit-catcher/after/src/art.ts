import type { Scene } from "phaser";

export const ZOOM = Math.min(window.devicePixelRatio, 2);
export const FONT = "system-ui, -apple-system, Roboto, sans-serif";
export const OUTLINE = "#1f4a10";

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

const vertical = (
  ctx: CanvasRenderingContext2D,
  y0: number,
  y1: number,
  stops: string[]
) => {
  const gradient = ctx.createLinearGradient(0, y0, 0, y1);
  stops.forEach((color, i) =>
    gradient.addColorStop(i / (stops.length - 1), color)
  );
  return gradient;
};

const ball = (
  ctx: CanvasRenderingContext2D,
  outline: string,
  stops: string[],
  shine: string
) => {
  ctx.fillStyle = outline;
  ctx.beginPath();
  ctx.arc(16, 19, 13, 0, Math.PI * 2);
  ctx.fill();
  const body = ctx.createRadialGradient(12, 15, 1, 16, 19, 12);
  stops.forEach((color, i) => body.addColorStop(i / (stops.length - 1), color));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(16, 19, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.ellipse(11.5, 14.5, 3.5, 2.5, -0.6, 0, Math.PI * 2);
  ctx.fill();
};

export const makeTextures = (scene: Scene) => {
  if (scene.textures.exists("sky")) {
    return;
  }
  texture(scene, "sky", 2, 256, (ctx) => {
    ctx.fillStyle = vertical(ctx, 0, 256, ["#5ebaed", "#8fd0f2", "#bee3f4"]);
    ctx.fillRect(0, 0, 2, 256);
  });
  texture(scene, "glow", 64, 64, (ctx) => {
    const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    glow.addColorStop(0, "rgba(255,255,255,1)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 64, 64);
  });
  texture(scene, "hills", 360, 130, (ctx) => {
    const top = new Path2D();
    for (let x = 0; x <= 360; x += 2) {
      const t = (x / 360) * Math.PI * 2;
      top.lineTo(x, 55 + Math.sin(t * 2) * 25 + Math.sin(t * 5) * 7);
    }
    const body = new Path2D(top);
    body.lineTo(360, 128);
    body.lineTo(0, 128);
    ctx.fillStyle = vertical(ctx, 20, 130, ["#9ad97a", "#68b84a"]);
    ctx.fill(body);
    ctx.strokeStyle = "#c9f2a8";
    ctx.lineWidth = 2.5;
    ctx.stroke(top);
  });
  texture(scene, "ground", 64, 128, (ctx) => {
    ctx.fillStyle = vertical(ctx, 0, 128, ["#468f24", "#2c5e14"]);
    ctx.fillRect(0, 0, 64, 128);
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    ctx.fillRect(5, 40, 20, 7);
    ctx.fillRect(37, 75, 20, 7);
    ctx.fillStyle = "#5fd926";
    ctx.fillRect(0, 0, 64, 11);
    ctx.fillStyle = "#a6f07e";
    ctx.fillRect(0, 0, 64, 3);
    ctx.fillStyle = "#3a7d1c";
    for (let x = 0; x < 64; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, 11);
      ctx.lineTo(x + 8, 18);
      ctx.lineTo(x + 16, 11);
      ctx.fill();
    }
  });
  texture(scene, "cloud", 110, 50, (ctx) => {
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    for (const [x, y, r] of [
      [30, 31, 17],
      [54, 23, 22],
      [80, 31, 16],
    ]) {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.roundRect(15, 30, 80, 18, 9);
    ctx.fill();
  });
  texture(scene, "apple", 32, 32, (ctx) => {
    ball(ctx, "#6e0f1c", ["#ff7a7a", "#e02633", "#a3121f"], "#ff9999");
    ctx.fillStyle = "#66401a";
    ctx.fillRect(15, 2, 2.5, 7);
    ctx.fillStyle = "#3a8f1a";
    ctx.beginPath();
    ctx.ellipse(23, 5, 5.5, 3, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#5fd926";
    ctx.beginPath();
    ctx.ellipse(22.5, 4.5, 4, 2, -0.4, 0, Math.PI * 2);
    ctx.fill();
  });
  texture(scene, "bomb", 32, 32, (ctx) => {
    ball(ctx, "#000000", ["#707070", "#2a2a2a", "#0b0b0b"], "#9a9a9a");
    ctx.fillStyle = "#3d3d3d";
    ctx.fillRect(12.5, 5, 7, 4);
    ctx.strokeStyle = "#664c33";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(16, 5);
    ctx.quadraticCurveTo(18, 1, 23, 2);
    ctx.stroke();
  });
  texture(scene, "basket", 82, 38, (ctx) => {
    ctx.fillStyle = vertical(ctx, 6, 38, ["#d4954f", "#b27333", "#8a5524"]);
    ctx.strokeStyle = "#4f2c0d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(6, 7);
    ctx.lineTo(76, 7);
    ctx.lineTo(70, 36);
    ctx.lineTo(12, 36);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "rgba(80,40,10,0.45)";
    ctx.lineWidth = 1.5;
    for (const y of [16, 25]) {
      ctx.beginPath();
      ctx.moveTo(8, y);
      ctx.lineTo(74, y);
      ctx.stroke();
    }
    ctx.fillStyle = "#804c1a";
    ctx.fillRect(21.5, 8, 4, 28);
    ctx.fillRect(56.5, 8, 4, 28);
    ctx.strokeStyle = "#4f2c0d";
    ctx.beginPath();
    ctx.roundRect(1, 1, 80, 8, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(5, 2.5, 72, 1.5);
  });
  texture(scene, "dot", 8, 8, (ctx) => {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(4, 4, 4, 0, Math.PI * 2);
    ctx.fill();
  });
};
