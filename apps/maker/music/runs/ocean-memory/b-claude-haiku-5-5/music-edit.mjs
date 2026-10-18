
import { writeFileSync } from "node:fs";
const SR = 44100, BPM = 72, BEAT = 60 / BPM, BAR = 4 * BEAT, BARS = 9;
const LOOP = BAR * BARS;
const L = Math.round(LOOP * SR);
const buf = new Float32Array(L);
let seed = 13;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const add = (idx, v) => { buf[((idx % L) + L) % L] += v; };

// Hollow, eerie marimba: long tail, detuned partial, wraps past loop end
function marimba(m, startSec, amp) {
  const f = mtof(m), s0 = Math.round(startSec * SR), n = Math.round(4.5 * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 2.6) * (1 - Math.exp(-t * 500));
    const v = Math.sin(2 * Math.PI * f * t)
            + 0.35 * Math.exp(-t * 9) * Math.sin(2 * Math.PI * 4.03 * f * t)
            + 0.12 * Math.exp(-t * 20) * Math.sin(2 * Math.PI * 6.9 * f * t);
    add(s0 + i, amp * env * v);
  }
}

// Dark pad: detuned sines snapped to 1/LOOP so the loop stays periodic
function pad(chord, bar) {
  const s0 = Math.round(bar * BAR * SR), n = Math.round(2 * BAR * SR);
  const freqs = chord.map(m => Math.round(mtof(m) * LOOP) / LOOP);
  for (let i = 0; i < n; i++) {
    const idx = s0 + i, t = idx / SR, x = i / n;
    const env = Math.pow(Math.sin(Math.PI * x), 2);
    let v = 0;
    for (const f of freqs) v += Math.sin(2 * Math.PI * f * t) + 0.6 * Math.sin(2 * Math.PI * (f + 3 / LOOP) * t);
    add(idx, 0.04 * env * v);
  }
}

// Low drone on D with a slow sub swell
for (let i = 0; i < L; i++) {
  const t = i / SR;
  buf[i] += 0.05 * Math.sin(2 * Math.PI * (Math.round(mtof(38) * LOOP) / LOOP) * t) * (0.7 + 0.3 * Math.sin(2 * Math.PI * t / LOOP));
}

// Diminished / tritone-heavy chords
const chords = [
  [50, 56, 59, 65], [46, 52, 58, 62], [42, 48, 54, 60], [48, 54, 60, 63], [43, 49, 55, 62],
  [45, 51, 57, 60], [41, 47, 53, 59], [50, 56, 59, 65], [45, 51, 57, 62]
];
// Chromatic, minor-second-tinged melody pool
const pool = [62, 63, 66, 69, 70, 74, 75];
const offsets = [0, 0.75, 1.5, 2.25, 2.75, 3.5];
chords.forEach((c, b) => pad(c, b));
for (let b = 0; b < BARS; b++) {
  const density = b < 2 ? 0.3 : b === 4 || b === 8 ? 0.45 : 0.55;
  for (const o of offsets) {
    if (rnd() < density) {
      const m = pool[Math.floor(rnd() * pool.length)];
      marimba(m, b * BAR + o * BEAT, 0.15 + rnd() * 0.06);
    }
  }
}

// Eerie slow tremolo, 5 cycles per loop
for (let i = 0; i < L; i++) buf[i] *= 0.7 + 0.3 * Math.sin(2 * Math.PI * 5 * i / L);

// Dark echo: delayed copies of the dry signal (circular, so tails wrap)
const dry = Float32Array.from(buf);
const taps = [[0.37, 0.4], [0.61, 0.25], [1.13, 0.12]];
for (const [sec, g] of taps) {
  const d = Math.round(sec * SR);
  for (let i = 0; i < L; i++) buf[i] += g * dry[((i - d) % L + L) % L];
}

// Muffle with circular one-pole lowpass (two passes)
for (let pass = 0; pass < 2; pass++) {
  let y = 0; const a = 0.18;
  for (let k = 0; k < 2 * L; k++) { const i = k % L; y += a * (buf[i] - y); if (k >= L) buf[i] = y; }
}

let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v));
const g = 0.7 / peak;
const D = Math.round(0.017 * SR);
const data = Buffer.alloc(L * 4);
for (let i = 0; i < L; i++) {
  const l = buf[i] * g, r = buf[(i - D + L) % L] * g;
  data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(l * 32767))), i * 4);
  data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r * 32767))), i * 4 + 2);
}
const h = Buffer.alloc(44);
h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
h.write("data", 36); h.writeUInt32LE(data.length, 40);
writeFileSync("music.wav", Buffer.concat([h, data]));
console.log("wrote music.wav, loop seconds:", (L / SR).toFixed(3));
