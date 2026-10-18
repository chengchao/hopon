
import { writeFileSync } from "node:fs";
const SR = 44100, BPM = 72, BEAT = 60 / BPM, BAR = 4 * BEAT, BARS = 9;
const LOOP = BAR * BARS;            // 30 s, whole number of bars
const L = Math.round(LOOP * SR);
const buf = new Float32Array(L);
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const add = (idx, v) => { buf[((idx % L) + L) % L] += v; };

// Soft marimba: sine + inharmonic-ish 4th partial, fast decay; wraps past loop end
function marimba(m, startSec, amp) {
  const f = mtof(m), s0 = Math.round(startSec * SR), n = Math.round(3.5 * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 4.5) * (1 - Math.exp(-t * 800));
    const v = Math.sin(2 * Math.PI * f * t) + 0.3 * Math.exp(-t * 14) * Math.sin(2 * Math.PI * 4 * f * t)
            + 0.08 * Math.exp(-t * 30) * Math.sin(2 * Math.PI * 9.2 * f * t);
    add(s0 + i, amp * env * v);
  }
}

// Pad: frequencies snapped to multiples of 1/LOOP so the loop is periodic; absolute time
function pad(chord, bar) {
  const s0 = Math.round(bar * BAR * SR), n = Math.round(2 * BAR * SR);
  const freqs = chord.map(m => Math.round(mtof(m) * LOOP) / LOOP);
  for (let i = 0; i < n; i++) {
    const idx = s0 + i, t = idx / SR;
    const x = i / n;
    const env = Math.pow(Math.sin(Math.PI * x), 2);
    let v = 0;
    for (const f of freqs) {
      v += Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * (f + 1 / LOOP * 3) * t);
    }
    add(idx, 0.035 * env * v);
  }
}

const chords = [
  [50, 57, 60, 65], [46, 53, 57, 60], [53, 57, 60, 64], [48, 55, 60, 64], [43, 50, 58, 62],
  [45, 52, 55, 60], [41, 48, 57, 60], [50, 57, 60, 64], [45, 52, 55, 59]
];
const pool = [62, 65, 69, 72, 74, 77, 81];
const offsets = [0, 0.75, 1.5, 2.25, 2.75, 3.5];
chords.forEach((c, b) => pad(c, b));
for (let b = 0; b < BARS; b++) {
  const density = b < 2 ? 0.35 : b === 4 || b === 8 ? 0.5 : 0.6;   // sparse intro, fuller B section
  for (const o of offsets) {
    if (rnd() < density) {
      const m = pool[Math.floor(rnd() * pool.length)];
      marimba(m, b * BAR + o * BEAT, 0.16 + rnd() * 0.06);
    }
  }
}

// Gentle slow swell on the whole mix (4 cycles per loop keeps it seamless)
for (let i = 0; i < L; i++) buf[i] *= 0.85 + 0.15 * Math.sin(2 * Math.PI * 4 * i / L);

// Underwater muffling: two circular one-pole lowpass passes (state carried around the loop)
for (let pass = 0; pass < 2; pass++) {
  let y = 0; const a = 0.22;
  for (let k = 0; k < 2 * L; k++) { const i = k % L; y += a * (buf[i] - y); if (k >= L) buf[i] = y; }
}

// Normalize
let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v));
const g = 0.7 / peak;

// Stereo with a small circular delay on the right for width
const D = Math.round(0.013 * SR);
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
