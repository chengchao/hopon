import { writeFileSync } from "node:fs";
const SR = 44100, BPM = 84, BEAT = 60 / BPM, BAR = 4 * BEAT, BARS = 12;
const N = Math.round(BARS * BAR * SR);
const L = new Float32Array(N), R = new Float32Array(N);
const TAU = 2 * Math.PI;
const m2f = m => 440 * Math.pow(2, (m - 69) / 12);
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

// Adds a voice into the circular loop buffer: tails past the end wrap onto the start.
function voice(start, dur, rel, pan, amp, fn) {
  const len = Math.round((dur + rel) * SR);
  const s = Math.round(start * SR);
  const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
  for (let k = 0; k < len; k++) {
    const v = fn(k / SR, dur, rel) * amp;
    const i = (s + k) % N;
    L[i] += v * gl; R[i] += v * gr;
  }
}

// Circular feedback delay: wraps around the loop so the echo tail continues into the start.
function echo(x, d, g) {
  const y = new Float32Array(N);
  for (let pass = 0; pass < 6; pass++)
    for (let i = 0; i < N; i++) y[i] = x[i] + g * y[(i - d + N) % N];
  return y;
}

const prog = [
  [57, 60, 64, 67], [53, 57, 60, 64], [48, 55, 59, 62], [55, 59, 62, 64],
  [57, 60, 64, 67], [53, 57, 60, 64], [48, 55, 59, 62], [55, 59, 62, 64],
  [50, 53, 57, 60], [46, 53, 57, 62], [48, 55, 59, 62], [57, 60, 64, 67]
];
const penta = [69, 72, 76, 79, 81, 84];
const INTRO = [0, 1, 2, 3], A = [4, 5, 6, 7], B = [8, 9, 10, 11];
const groove = [...A, ...B];

for (let b = 0; b < BARS; b++) {
  const t0 = b * BAR;
  // Pad: slow detuned harmonic chords, sustained through the bar and released into the next.
  for (const m of prog[b]) {
    const f = m2f(m);
    const pan = (((m * 37) % 100) / 50 - 1) * 0.5;
    voice(t0, BAR * 0.98, 1.0, pan, 0.07, (t, d, rel) => {
      const e = Math.min(1, t / 0.03) * (t < d ? 1 : Math.max(0, 1 - (t - d) / rel));
      let s = 0;
      for (const dt of [-0.003, 0, 0.003]) {
        const g = f * (1 + dt);
        s += Math.sin(TAU * g * t) + 0.5 * Math.sin(TAU * 2 * g * t) + 0.25 * Math.sin(TAU * 3 * g * t);
      }
      return e * s * 0.3;
    });
  }
  // Bells: sparse in intro, denser in B.
  const beats = b in INTRO ? [0, 2.5] : b in A ? [1.5, 3] : [0, 1.5, 2.5, 3.5];
  for (const bt of beats) {
    const m = penta[Math.floor(rnd() * penta.length)];
    const f = m2f(m);
    voice(t0 + bt * BEAT, 0.1, 2.5, rnd() * 1.2 - 0.6, 0.09, t =>
      Math.min(1, t / 0.003) * Math.exp(-t * 3.2) * (Math.sin(TAU * f * t) + 0.35 * Math.sin(TAU * f * 2.76 * t)));
  }
  if (groove.includes(b)) {
    const chord = prog[b];
    // Arpeggio: eighth notes walking the chord, octave up in the second half of the bar.
    const pat = [0, 1, 2, 3, 2, 1, 2, 3];
    for (let j = 0; j < 8; j++) {
      const m = chord[pat[j]] + (j >= 4 ? 12 : 0);
      const f = m2f(m);
      voice(t0 + j * BEAT / 2, 0.3, 0.25, j % 2 ? 0.4 : -0.4, 0.1, (t, d, rel) =>
        Math.min(1, t / 0.004) * Math.exp(-t * 9) * (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * 2 * f * t)));
    }
    // Soft kick on beats 1 and 3.
    for (const bt of [0, 2]) {
      voice(t0 + bt * BEAT, 0.05, 0.4, 0, 0.9, t => {
        const ph = TAU * (45 * t + 65 * (1 - Math.exp(-25 * t)) / 25);
        return Math.sin(ph) * Math.exp(-t * 14);
      });
    }
    // Light hats on offbeats.
    for (let j = 0; j < 4; j++) {
      voice(t0 + (2 * j + 1) * BEAT / 2, 0.02, 0.1, rnd() * 0.8 - 0.4, 0.04, t => (rnd() * 2 - 1) * Math.exp(-t * 90));
    }
  }
}

// Echo: cross-fed stereo delays, both circular.
const eL = echo(R, Math.round(0.375 * SR), 0.4);
const eR = echo(L, Math.round(0.5 * SR), 0.4);
let peak = 0;
const out = new Float32Array(N * 2);
for (let i = 0; i < N; i++) {
  const l = L[i] + 0.3 * eL[i], r = R[i] + 0.3 * eR[i];
  out[2 * i] = l; out[2 * i + 1] = r;
  peak = Math.max(peak, Math.abs(l), Math.abs(r));
}
const k = 0.85 / peak;
const buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write("WAVE", 8);
buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write("data", 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N * 2; i++) {
  const v = Math.max(-1, Math.min(1, out[i] * k));
  buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
}
writeFileSync("music.wav", buf);
console.log("samples", N, "seconds", (N / SR).toFixed(3), "peak", peak.toFixed(3));
