
import { writeFileSync } from "node:fs";
const SR = 44100, BPM = 132, BEAT = 60 / BPM, BARS = 33;
const N = Math.round(BARS * 2 * BEAT * SR); // exact 30.000 s = 1323000 samples
const M = 2 * N; // render two loop lengths, then fold the tails back onto the start
const L = new Float32Array(M), R = new Float32Array(M);
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const hz = m => 440 * Math.pow(2, (m - 69) / 12);

function note(t, dur, freq, wave, vol, decay, pan = 0) {
  const s0 = Math.floor(t * SR), len = Math.floor(SR * (dur + 1.2));
  const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
  let ph = 0; const inc = freq / SR;
  for (let i = 0; i < len; i++) {
    const idx = s0 + i; if (idx >= M) break;
    const tt = i / SR;
    const env = Math.min(1, tt / 0.008) * Math.exp(-decay * tt);
    ph += inc; const p = ph - Math.floor(ph);
    const v = wave === "sq" ? (p < 0.5 ? 1 : -1) : wave === "saw" ? 2 * p - 1 : wave === "tri" ? 4 * Math.abs(p - 0.5) - 1 : Math.sin(2 * Math.PI * p);
    const s = v * env * vol;
    L[idx] += s * gl; R[idx] += s * gr;
  }
}
function kick(t, vol = 0.9) {
  const s0 = Math.floor(t * SR), len = Math.floor(SR * 0.25); let ph = 0;
  for (let i = 0; i < len; i++) {
    const idx = s0 + i; if (idx >= M) break; const tt = i / SR;
    const f = 40 + 120 * Math.exp(-tt * 30); ph += f / SR;
    const s = Math.sin(2 * Math.PI * ph) * Math.exp(-tt * 12) * vol;
    L[idx] += s; R[idx] += s;
  }
}
function snare(t, vol = 0.35) {
  const s0 = Math.floor(t * SR), len = Math.floor(SR * 0.2);
  for (let i = 0; i < len; i++) {
    const idx = s0 + i; if (idx >= M) break; const tt = i / SR;
    const s = ((rnd() * 2 - 1) * Math.exp(-tt * 30) * 0.6 + Math.sin(2 * Math.PI * 190 * tt) * Math.exp(-tt * 25) * 0.5) * vol;
    L[idx] += s; R[idx] += s * 0.9;
  }
}
function hat(t, vol) {
  const s0 = Math.floor(t * SR), len = Math.floor(SR * 0.08); let prev = 0;
  for (let i = 0; i < len; i++) {
    const idx = s0 + i; if (idx >= M) break; const tt = i / SR;
    const n = rnd() * 2 - 1; const hp = n - prev; prev = n;
    const s = hp * Math.exp(-tt * 70) * vol;
    L[idx] += s * 0.8; R[idx] += s * 1.0;
  }
}

// Oom-pah chords: bass root (low), triad (for the pah)
const CH = {
  G:  { bass: 43, tri: [59, 62, 67] },
  C:  { bass: 48, tri: [60, 64, 67] },
  D:  { bass: 50, tri: [62, 66, 69] },
  Em: { bass: 40, tri: [59, 64, 67] },
  Am: { bass: 45, tri: [60, 64, 69] },
};
const A1 = ["G","C","G","D","G","C","Em","D"];
const B1 = ["C","G","Am","D","C","G","D","G"];
const prog = [
  "G","G","C","D",                 // intro (4)
  ...A1,                           // A (8)
  ...B1,                           // B (8)
  ...A1,                           // A (8)
  "G","C","G","D","G"              // outro (5)
];
const sectionOf = b => b < 4 ? "I" : b < 12 ? "A" : b < 20 ? "B" : b < 28 ? "A" : "O";

for (let b = 0; b < BARS; b++) {
  const c = CH[prog[b]], t0 = b * 2 * BEAT, sec = sectionOf(b);
  // oom: bass on beat 1, plus soft pick-up on the and of 2
  note(t0, BEAT * 0.85, hz(c.bass), "tri", 0.55, 4, -0.25);
  if (sec !== "I") note(t0 + BEAT * 1.5, BEAT * 0.4, hz(c.bass + 12), "tri", 0.12, 8, -0.25);
  // pah: chord stab on beat 2, bouncy saw voicing
  c.tri.forEach((m, k) => note(t0 + BEAT, BEAT * 0.35, hz(m), "saw", 0.055, 10, (k - 1) * 0.5));
  // drums: kick on 1, snare on 2, hats on eighths
  kick(t0);
  if (sec !== "I" || b >= 2) snare(t0 + BEAT);
  for (let k = 0; k < 4; k++) hat(t0 + k * BEAT / 2, k % 2 ? 0.05 : 0.11);
  // frantic sixteenth-note lead: 8 slots per bar, chord-tone based, some rests
  const tri = c.tri, oct = sec === "B" ? 12 : 0;
  const pool = [tri[0] + 12, tri[1] + 12, tri[2] + 12, tri[0] + 14, tri[2] + 10];
  if (sec !== "I" || b >= 2) for (let j = 0; j < 8; j++) {
    if (rnd() < 0.2) continue;
    const m = pool[Math.floor(rnd() * pool.length)] + oct;
    note(t0 + j * BEAT / 4, BEAT / 4 * 0.85, hz(m), "sq", 0.075, 7, 0.35);
  }
}

// Gentle dotted-eighth echo (feedback), applied on the doubled buffer
const d = Math.round(BEAT * 0.75 * SR);
for (const ch of [L, R]) for (let i = d; i < M; i++) ch[i] += 0.28 * ch[i - d];

// Fold tails back onto the start so the loop is seamless
const out = new Float32Array(N * 2);
for (let i = 0; i < N; i++) { out[2 * i] = L[i] + L[i + N]; out[2 * i + 1] = R[i] + R[i + N]; }
let peak = 0; for (const v of out) peak = Math.max(peak, Math.abs(v));
const g = 0.85 / peak;

// WAV: 44.1 kHz, 16-bit, stereo
const dataBytes = N * 2 * 2;
const buf = Buffer.alloc(44 + dataBytes);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + dataBytes, 4); buf.write("WAVE", 8);
buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write("data", 36); buf.writeUInt32LE(dataBytes, 40);
for (let i = 0; i < out.length; i++) {
  const s = Math.max(-1, Math.min(1, out[i] * g));
  buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
}
writeFileSync("music.wav", buf);
console.log("wrote music.wav, samples:", N, "duration:", (N / SR).toFixed(3), "s, peak before norm:", peak.toFixed(3));
