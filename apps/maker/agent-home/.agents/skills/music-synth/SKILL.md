---
name: music-synth
description: How to write a game's looping background music as music.mjs, a Node script that synthesizes everything and renders music.wav. Load when a job asks for music.
---

# Writing music.mjs

The music is one original loop, played on repeat under the game. You write it as `music.mjs`, a Node.js script that synthesizes everything itself: oscillators, envelopes, drums, effects and the mix. Only `node:` built-ins; no packages. The hopon harness turns `music.wav` into the game's audio after you finish.

## Rules

- Output exactly one file, `music.wav` in the workspace: 44.1 kHz, 16-bit PCM, stereo.
- 20–40 seconds, a whole number of bars at one tempo, arranged in sections (for example intro, A, B).
- It must loop seamlessly: no fade-in or fade-out and no silence at either end. Write every sample through `put`, which wraps tails onto the start; the echo and the low-pass wrap too.
- Build on the skeleton and keep its oscillators and master chain: its saw and pulse are band-limited, and the chain (echo, low-pass, soft limit) sets the level. Never write a raw square or saw such as `p % 1 < 0.5 ? 1 : -1`: it aliases into a harsh fizz.
- Volumes are relative; the master normalizes the mix.
- Fit the brief's genre and mood, and keep it under the game.
- Render it with bash: `node music.mjs`, then check the printed duration. For a change, edit the script and render again.

## Arranging

- Give each part its own register, wave and place: bass on `triangle` or `sine`, low, centered and dry; chords or a pad on `saw` or `pulse` with a slow attack and a low volume; the lead on `pulse` or `saw` with `vibrato` around 0.15 and some `echo`; an arpeggio quiet and panned side to side.
- Set `CUTOFF` to the style: 8000 for bright ones such as chiptune or pop, 4000–6000 for soft, warm or lo-fi ones.
- Change something at each section: add or drop a part, lift the melody, busier hats.

## Skeleton

```js
import { writeFileSync } from "node:fs";

const RATE = 44100;
const BPM = 120;
const BEAT = 60 / BPM;
const BARS = 16;
const CUTOFF = 8000;
const LENGTH = Math.round(BARS * 4 * BEAT * RATE);
const mix = [new Float32Array(LENGTH), new Float32Array(LENGTH)];
const send = [new Float32Array(LENGTH), new Float32Array(LENGTH)];

const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);
const at = (beat) => Math.round(beat * BEAT * RATE);
const panGains = (pan) => [
  Math.cos(((pan + 1) * Math.PI) / 4),
  Math.sin(((pan + 1) * Math.PI) / 4),
];
function put(i, v, [gl, gr] = [0.707, 0.707], echo = 0) {
  const j = i % LENGTH;
  mix[0][j] += v * gl;
  mix[1][j] += v * gr;
  send[0][j] += v * gl * echo;
  send[1][j] += v * gr * echo;
}

let seed = 1;
const noise = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 31 - 1;

const polyBlep = (t, dt) => {
  if (t < dt) {
    const x = t / dt;
    return 2 * x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + 2 * x + 1;
  }
  return 0;
};
const osc = {
  sine: (p) => Math.sin(2 * Math.PI * p),
  triangle: (p) => 1 - 4 * Math.abs((p % 1) - 0.5),
  saw: (p, dt) => 2 * (p % 1) - 1 - polyBlep(p % 1, dt),
  pulse: (p, dt, duty) => {
    const q = p % 1;
    return (
      (q < duty ? 1 : -1) +
      polyBlep(q, dt) -
      polyBlep((q - duty + 1) % 1, dt) -
      (2 * duty - 1)
    );
  },
};

function note({
  start,
  midi,
  beats,
  wave = "triangle",
  duty = 0.5,
  volume = 0.2,
  pan = 0,
  echo = 0,
  attack = 0.01,
  decay = 0.2,
  sustain = 0.7,
  release = 0.2,
  vibrato = 0,
}) {
  const s0 = at(start);
  const held = beats * BEAT;
  const f0 = freq(midi);
  const gains = panGains(pan);
  const level = (t) =>
    t < attack
      ? t / attack
      : sustain + (1 - sustain) * Math.exp(-(t - attack) / decay);
  const end = level(held);
  let p = 0;
  for (let i = 0; i < (held + release) * RATE; i++) {
    const t = i / RATE;
    const env = t < held ? level(t) : end * (1 - (t - held) / release);
    const wobble =
      vibrato * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, t / 0.3);
    const dt = (f0 * 2 ** (wobble / 12)) / RATE;
    p += dt;
    put(s0 + i, osc[wave](p, dt, duty) * env * volume, gains, echo);
  }
}

function kick(start, volume = 0.5) {
  let p = 0;
  for (let i = 0; i < RATE * 0.3; i++) {
    const t = i / RATE;
    p += (45 + 110 * Math.exp(-t * 30)) / RATE;
    const body = Math.sin(2 * Math.PI * p) * Math.exp(-t * 9);
    put(at(start) + i, (body + noise() * Math.exp(-t * 400) * 0.2) * volume);
  }
}

function snare(start, volume = 0.25, echo = 0) {
  for (let i = 0; i < RATE * 0.2; i++) {
    const t = i / RATE;
    const body = Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 30) * 0.5;
    put(
      at(start) + i,
      (noise() * Math.exp(-t * 22) + body) * volume,
      undefined,
      echo
    );
  }
}

function hat(start, volume = 0.06, open = false) {
  const gains = panGains(0.3);
  let last = 0;
  for (let i = 0; i < RATE * (open ? 0.3 : 0.05); i++) {
    const n = noise();
    put(
      at(start) + i,
      (n - last) * 0.5 * Math.exp((-i / RATE) * (open ? 12 : 70)) * volume,
      gains
    );
    last = n;
  }
}

function pingPong(beats = 0.75, feedback = 0.4, repeats = 4) {
  for (let k = 1, gain = 1; k <= repeats; k++, gain *= feedback) {
    const shift = at(beats * k);
    const [l, r] = k % 2 ? [send[1], send[0]] : send;
    for (let i = 0; i < LENGTH; i++) {
      mix[0][(i + shift) % LENGTH] += l[i] * gain;
      mix[1][(i + shift) % LENGTH] += r[i] * gain;
    }
  }
}

function lowpass(x, cutoff) {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / RATE);
  let y = 0;
  for (let i = LENGTH - RATE; i < LENGTH; i++) {
    y += a * (x[i] - y);
  }
  for (let i = 0; i < LENGTH; i++) {
    y += a * (x[i] - y);
    x[i] = y;
  }
}

// … write the sections: chords, bass, melody, drums …

pingPong(0.75, 0.4);
lowpass(mix[0], CUTOFF);
lowpass(mix[1], CUTOFF);
const DRIVE = 1.2;
let peak = 0;
for (const ch of mix) {
  for (const v of ch) {
    peak = Math.max(peak, Math.abs(v));
  }
}
for (const ch of mix) {
  for (let i = 0; i < LENGTH; i++) {
    ch[i] = Math.tanh((ch[i] * DRIVE) / peak);
  }
}

const data = Buffer.alloc(LENGTH * 4);
for (let i = 0; i < LENGTH; i++) {
  data.writeInt16LE(Math.round(mix[0][i] * 32767), i * 4);
  data.writeInt16LE(Math.round(mix[1][i] * 32767), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVEfmt ", 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);
writeFileSync("music.wav", Buffer.concat([header, data]));
console.log(
  `music.wav ${(LENGTH / RATE).toFixed(1)} s, peak ${Math.tanh(DRIVE).toFixed(2)}`
);
```
