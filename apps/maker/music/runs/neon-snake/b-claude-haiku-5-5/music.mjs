
import { writeFileSync } from "node:fs";
const SR = 44100, BPM = 120, spb = 60 / BPM, bar = 4 * spb, BARS = 16;
const N = Math.round(BARS * bar * SR);
const L = new Float32Array(N), R = new Float32Array(N);
const f = m => 440 * Math.pow(2, (m - 69) / 12);
const saw = (fr, t) => 2 * ((fr * t) % 1) - 1;
const sq = (fr, t) => ((fr * t) % 1) < 0.5 ? 1 : -1;
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff * 2 - 1;
function put(start, len, pan, fn) {
  const s = Math.round(start * SR), n = Math.round(len * SR);
  const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
  for (let k = 0; k < n; k++) {
    const v = fn(k / SR);
    const idx = (s + k) % N; // wrap tails onto the start
    L[idx] += v * gl; R[idx] += v * gr;
  }
}
const C = { Am: [45, [0, 3, 7]], F: [41, [0, 4, 7]], C: [48, [0, 4, 7]], G: [43, [0, 4, 7]], Em: [40, [0, 3, 7]] };
const prog = ["Am","F","C","G","Am","F","C","G","F","G","Em","Am","Am","F","C","G"];
for (let b = 0; b < BARS; b++) {
  const t0 = b * bar, [root, ints] = C[prog[b]];
  // pad (all sections)
  for (const iv of ints) {
    const fr = f(root + 12 + iv);
    put(t0, bar + 0.3, -0.2, t => (saw(fr, t) + saw(fr * 1.006, t)) * 0.025 * Math.min(1, t / 0.25) * Math.exp(-Math.max(0, t - bar) * 8));
  }
  // bass: 8th notes
  const offs = b >= 8 && b < 12 ? [0, 12, 0, 12, 0, 7, 0, 3] : [0, 0, 12, 0, 0, 0, 7, 0];
  for (let e = 0; e < 8; e++) {
    const fr = f(root + offs[e]);
    put(t0 + e * spb / 2, spb / 2 + 0.12, 0, t => (sq(fr, t) * 0.5 + Math.sin(2 * Math.PI * fr * t) * 0.5) * 0.22 * Math.min(1, t / 0.003) * Math.exp(-t * 7));
  }
  if (b < 4) continue; // intro: no drums or lead
  // kick
  for (let q = 0; q < 4; q++) {
    put(t0 + q * spb, 0.4, 0, t => Math.sin(2 * Math.PI * (48 * t + 110 * (1 - Math.exp(-30 * t)) / 30)) * Math.exp(-t * 9) * 0.9);
  }
  // snare on 2 and 4
  for (const q of [1, 3]) {
    put(t0 + q * spb, 0.25, 0, t => (rnd() * 0.35 * Math.exp(-t * 25)) + Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 35) * 0.3);
  }
  // hats on offbeat eighths
  for (let e = 0; e < 8; e++) {
    let prev = 0;
    put(t0 + e * spb / 2 + spb / 4, 0.1, -0.35, t => { const n = rnd(); const hp = n - prev; prev = n; return hp * 0.12 * Math.exp(-t * 60); });
  }
  // lead arpeggio on 16ths
  for (let s16 = 0; s16 < 16; s16++) {
    const idx = [0, 1, 2, 1][s16 % 4];
    const fr = f(root + 24 + ints[idx] + (b >= 8 && b < 12 && s16 >= 12 ? 5 : 0));
    put(t0 + s16 * spb / 4, spb / 4 + 0.1, 0.45, t => sq(fr, t) * 0.07 * Math.min(1, t / 0.003) * Math.exp(-t * 14));
  }
}
// circular echo (dotted eighth taps), seamless across loop
const dL = Float32Array.from(L), dR = Float32Array.from(R);
for (const [sec, g] of [[0.375, 0.35], [0.75, 0.15], [1.125, 0.07]]) {
  const d = Math.round(sec * SR);
  for (let i = 0; i < N; i++) { L[(i + d) % N] += dL[i] * g; R[(i + d) % N] += dR[i] * g; }
}
// normalize + soft clip
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const k = 0.8 / peak;
const out = Buffer.alloc(44 + N * 4);
out.write("RIFF", 0); out.writeUInt32LE(36 + N * 4, 4); out.write("WAVE", 8);
out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22);
out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34);
out.write("data", 36); out.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  const l = Math.tanh(L[i] * k * 1.1), r = Math.tanh(R[i] * k * 1.1);
  out.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(l * 32767))), 44 + i * 4);
  out.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(r * 32767))), 46 + i * 4);
}
writeFileSync("music.wav", out);
console.log("wrote music.wav");
