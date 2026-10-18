import { writeFileSync } from "node:fs";

const SR = 44100;
const BARS = 16;
const N = BARS * 2 * SR;          // 2 s per bar at 120 BPM -> 32 s, exact integer
const EIGHTH = SR / 4;            // 0.25 s
const L = new Float64Array(N), R = new Float64Array(N);

let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// Pitched voice; writes modulo N so tails wrap around onto the start (seamless loop)
function voice(start, len, o) {
  const { wave = "square", vol = 0.2, pan = 0, att = 0.005, decay = 3, duty = 0.5, f } = o;
  const total = len + Math.round(0.25 * SR);
  const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
  for (let k = 0; k < total; k++) {
    const t = k / SR;
    const ph = (f * t) % 1;
    let w;
    if (wave === "square") w = ph < duty ? 1 : -1;
    else if (wave === "tri") w = 4 * Math.abs(ph - 0.5) - 1;
    else w = Math.sin(2 * Math.PI * ph);
    const env = Math.min(1, k / (att * SR)) * Math.exp(-decay * t);
    const s = w * env * vol;
    const i = (start + k) % N;
    L[i] += s * gl; R[i] += s * gr;
  }
}

function drum(start, len, fn) {
  for (let k = 0; k < len; k++) {
    const s = fn(k / SR) * 0.7;
    const i = (start + k) % N;
    L[i] += s; R[i] += s;
  }
}
const kick = start => drum(start, Math.round(0.25 * SR), t =>
  Math.sin(2 * Math.PI * (40 * t + 110 * (1 - Math.exp(-25 * t)) / 25)) * Math.exp(-12 * t) * 0.8);
const snare = start => drum(start, Math.round(0.2 * SR), t =>
  rnd() * 0.35 * Math.exp(-25 * t) + 0.3 * Math.sin(2 * Math.PI * 185 * t) * Math.exp(-30 * t));
let prevN = 0;
const hat = start => drum(start, Math.round(0.06 * SR), t => {
  const n = rnd(); const hp = n - prevN; prevN = n;
  return hp * 0.25 * Math.exp(-90 * t);
});

// Melody phrases (eighth-note grid, -1 = hold, 0 = rest), 2 bars each
const P1 = [76,-1,79,-1,84,-1,79,-1, 76,-1,74,-1,72,-1,0,-1];
const P2 = [81,-1,79,-1,76,-1,77,-1, 79,-1,76,-1,74,-1,0,-1];
const P3 = [84,-1,86,-1,88,-1,86,-1, 84,-1,81,-1,79,-1,76,-1];
const P4 = [79,-1,81,-1,84,-1,81,-1, 79,-1,77,-1,76,-1,0,-1];
const seq = [P1, P2, P3, P4, P1, P2];  // A, A, B, B, A, A on bars 4-15

// Chords: C, G, Am, F (one per bar, looping every 4 bars)
const chordRoot = [60, 55, 57, 53];
const chordMinor = [false, false, true, false];
const bassRoot = [36, 31, 33, 29];
const bassPat = [0, 0, 12, 0, 7, 0, 12, 0];

for (let b = 0; b < BARS; b++) {
  const ci = b % 4;
  const base = chordRoot[ci];
  const third = chordMinor[ci] ? 3 : 4;
  const barStart = b * 8;

  // Soft triangle pad under every bar
  for (const iv of [0, third, 7]) {
    voice(Math.round(barStart * EIGHTH), 8 * EIGHTH, { wave: "tri", vol: 0.035, f: mtof(base - 12 + iv), decay: 0.8, pan: 0 });
  }

  // Intro: bouncy triangle arpeggio
  if (b < 4) {
    const arp = [0, third, 7, 12];
    for (let e = 0; e < 8; e++) {
      voice(Math.round((barStart + e) * EIGHTH), Math.round(0.2 * EIGHTH * 4), { wave: "tri", vol: 0.07, f: mtof(base + 12 + arp[e % 4]), decay: 6, pan: -0.4 });
    }
  }

  // Bass: bouncy octave-jump square pattern from bar 2 on
  if (b >= 2) {
    for (let e = 0; e < 8; e++) {
      voice(Math.round((barStart + e) * EIGHTH), Math.round(0.7 * EIGHTH), { wave: "square", duty: 0.25, vol: 0.12, f: mtof(bassRoot[ci] + bassPat[e]), decay: 9, pan: -0.1 });
    }
  }

  // Drums
  for (let e = 0; e < 8; e++) {
    const start = Math.round((barStart + e) * EIGHTH);
    if (b >= 2 && (e === 0 || e === 4)) kick(start);
    if (b >= 4 && (e === 2 || e === 6)) snare(start);
    if (b >= 8 && b < 12 && e === 7) kick(start);
    if (e % 2 === 1 && (b >= 2)) hat(start);
  }
}

// Lead melody: A (bars 4-7), B (bars 8-11), A (bars 12-15)
for (let p = 0; p < 6; p++) {
  const P = seq[p];
  const startE = (4 + 2 * p) * 8;
  for (let i = 0; i < 16; i++) {
    const v = P[i];
    if (v <= 0) continue;
    let len = 1;
    while (i + len < 16 && P[i + len] === -1) len++;
    voice(Math.round((startE + i) * EIGHTH), Math.round(len * EIGHTH), { wave: "square", duty: 0.4, vol: 0.12, f: mtof(v), decay: 2.2, pan: 0.3 });
  }
}

// Circular echo (dotted eighth), seamless because it wraps too
const D = Math.round(0.375 * SR);
const ml = Float64Array.from(L), mr = Float64Array.from(R);
for (let i = 0; i < N; i++) {
  L[i] = ml[i] + 0.28 * ml[(i - D + N) % N];
  R[i] = mr[i] + 0.28 * mr[(i - D + N) % N];
}

// Normalize and soft clip
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const g = 0.89 / peak;

// 16-bit stereo WAV
const dataBytes = N * 2 * 2;
const buf = Buffer.alloc(44 + dataBytes);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + dataBytes, 4); buf.write("WAVE", 8);
buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write("data", 36); buf.writeUInt32LE(dataBytes, 40);
let o = 44;
for (let i = 0; i < N; i++) {
  for (const c of [L[i], R[i]]) {
    const v = Math.max(-1, Math.min(1, Math.tanh(c * g * 1.1)));
    buf.writeInt16LE(Math.round(v * 32767), o); o += 2;
  }
}
writeFileSync("music.wav", buf);
console.log("wrote music.wav, samples:", N, "duration:", (N / SR).toFixed(3), "s");
