import { writeFileSync } from "node:fs";
const SR = 44100, BPM = 84, BEAT = 60 / BPM, BAR = 4 * BEAT, BARS = 12;
const N = Math.round(BARS * BAR * SR);
const L = new Float32Array(N), R = new Float32Array(N);
const TAU = 2 * Math.PI;
const m2f = m => 440 * Math.pow(2, (m - 69) / 12);
let seed = 666;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

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

function echo(x, d, g) {
  const y = new Float32Array(N);
  for (let pass = 0; pass < 8; pass++)
    for (let i = 0; i < N; i++) y[i] = x[i] + g * y[(i - d + N) % N];
  return y;
}

// Eerie chords: minor with flat-2 and tritone colour, low register.
const prog = [
  [45, 48, 52, 55], [46, 49, 53, 56], [43, 46, 50, 53], [40, 46, 49, 52],
  [45, 48, 52, 55], [46, 49, 53, 56], [43, 46, 50, 53], [40, 46, 49, 52],
  [38, 41, 44, 48], [41, 45, 48, 52], [40, 44, 47, 51], [45, 48, 52, 55]
];
const eerie = [69, 70, 74, 76, 77, 81]; // minor/phrygian bell notes
const INTRO = [0, 1, 2, 3], A = [4, 5, 6, 7], B = [8, 9, 10, 11];
const groove = [...A, ...B];

for (let b = 0; b < BARS; b++) {
  const t0 = b * BAR;
  // Pad: wide detune, slow tremolo, dark sub-octave.
  for (const m of prog[b]) {
    const f = m2f(m);
    const pan = (((m * 37) % 100) / 50 - 1) * 0.7;
    voice(t0, BAR * 0.98, 1.2, pan, 0.075, (t, d, rel) => {
      const e = Math.min(1, t / 0.05) * (t < d ? 1 : Math.max(0, 1 - (t - d) / rel));
      const trem = 0.75 + 0.25 * Math.sin(TAU * 0.4 * t + m);
      let s = 0;
      for (const dt of [-0.008, 0, 0.008]) {
        const g = f * (1 + dt);
        s += Math.sin(TAU * g * t) + 0.6 * Math.sin(TAU * 2 * g * t * 1.0) + 0.2 * Math.sin(TAU * 3 * g * t);
      }
      return e * trem * s * 0.28;
    });
  }
  // Sub drone on chord root.
  voice(t0, BAR * 0.98, 1.2, 0, 0.12, (t, d, rel) => {
    const e = Math.min(1, t / 0.1) * (t < d ? 1 : Math.max(0, 1 - (t - d) / rel));
    return e * Math.sin(TAU * m2f(prog[b][0] - 12) * t);
  });
  // Eerie bells with tritone shimmer, slow bloom and long decay.
  const beats = b in INTRO ? [0, 2.5] : b in A ? [1.5, 3] : [0, 1.25, 2.5, 3.5];
  for (const bt of beats) {
    const m = eerie[Math.floor(rnd() * eerie.length)];
    const f = m2f(m);
    voice(t0 + bt * BEAT, 0.15, 3.5, rnd() * 1.4 - 0.7, 0.085, t =>
      Math.min(1, t / 0.12) * Math.exp(-t * 1.8) * (Math.sin(TAU * f * t) + 0.4 * Math.sin(TAU * f * 1.414 * t)));
  }
  if (groove.includes(b)) {
    const chord = prog[b];
    // Sparse, dark arpeggio drifting down an octave on the second half.
    const pat = [0, 1, 2, 1, 3, 2, 1, 0];
    for (let j = 0; j < 8; j++) {
      const m = chord[pat[j]] + (j >= 4 ? 12 : 0) + 12;
      const f = m2f(m);
      voice(t0 + j * BEAT / 2, 0.3, 0.3, j % 2 ? 0.5 : -0.5, 0.075, (t) =>
        Math.min(1, t / 0.004) * Math.exp(-t * 7) * (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * 2.02 * f * t)));
    }
    // Soft, heavier kick.
    for (const bt of [0, 2]) {
      voice(t0 + bt * BEAT, 0.05, 0.5, 0, 0.9, t => {
        const ph = TAU * (40 * t + 60 * (1 - Math.exp(-22 * t)) / 22);
        return Math.sin(ph) * Math.exp(-t * 11);
      });
    }
    // Ghostly offbeat ticks.
    for (let j = 0; j < 4; j++) {
      voice(t0 + (2 * j + 1) * BEAT / 2, 0.02, 0.1, rnd() * 0.8 - 0.4, 0.03, t => (rnd() * 2 - 1) * Math.exp(-t * 80));
    }
  }
}

// Wind bed: lowpassed noise, swelling twice per loop so it wraps seamlessly.
{
  let lp = 0;
  for (let i = 0; i < N; i++) {
    lp += 0.002 * ((rnd() * 2 - 1) - lp);
    const swell = 0.5 + 0.5 * Math.sin(TAU * 2 * i / N);
    const v = lp * 2.2 * swell * 0.5;
    L[i] += v * 0.9; R[i] += v * (0.6 + 0.4 * Math.sin(TAU * i / N));
  }
}

const eL = echo(R, Math.round(0.5 * SR), 0.55);
const eR = echo(L, Math.round(0.7 * SR), 0.55);
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
console.log("seconds", (N / SR).toFixed(3), "peak", peak.toFixed(3));
