---
name: music-synth
description: How to write a game's looping background music as music.mjs, a Node script that synthesizes everything and renders music.wav. Load when a job asks for music.
---

# Writing music.mjs

The music is one original loop, played on repeat under the game. You write it as `music.mjs`, a Node.js script that synthesizes everything itself: oscillators, envelopes, drums, effects and the mix. Only `node:` built-ins; no packages. The hopon harness turns `music.wav` into the game's audio after you finish.

## Rules

- Output exactly one file, `music.wav` in the workspace: 44.1 kHz, 16-bit PCM, mono or stereo.
- 20–40 seconds, a whole number of bars at one tempo, arranged in sections (for example intro, A, B).
- It must loop seamlessly: no fade-in or fade-out, no silence at either end, and the tails of the last notes wrap around onto the start (write samples at `index % length`).
- Fit the brief's genre and mood, and keep it under the game: no harsh highs, peaks below 0.9.
- Render it with bash: `node music.mjs`, then check its duration. For a change, edit the script and render again.

## Skeleton

```js
import { writeFileSync } from "node:fs";

const RATE = 44100;
const BPM = 120;
const BEAT = 60 / BPM;
const BARS = 16; // 16 bars of 4/4 at 120 BPM = 32 s
const LENGTH = Math.round(BARS * 4 * BEAT * RATE);
const left = new Float32Array(LENGTH);
const right = new Float32Array(LENGTH);

const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);
const osc = {
  sine: (p) => Math.sin(2 * Math.PI * p),
  square: (p) => (p % 1 < 0.5 ? 1 : -1),
  saw: (p) => 2 * (p % 1) - 1,
  triangle: (p) => 1 - 4 * Math.abs((p % 1) - 0.5),
};

// Adds one note; samples past the end wrap onto the start, so the loop is seamless.
function note({
  start,
  midi,
  beats,
  wave = "triangle",
  volume = 0.2,
  pan = 0,
  attack = 0.01,
  release = 0.2,
}) {
  const f = freq(midi);
  const s0 = Math.round(start * BEAT * RATE);
  const held = beats * BEAT;
  const total = Math.round((held + release) * RATE);
  for (let i = 0; i < total; i++) {
    const t = i / RATE;
    const env =
      t < attack
        ? t / attack
        : t < held
          ? 1
          : Math.max(0, 1 - (t - held) / release);
    const v = osc[wave](f * t) * env * volume;
    const at = (s0 + i) % LENGTH;
    left[at] += v * (1 - pan) * 0.5;
    right[at] += v * (1 + pan) * 0.5;
  }
}

function kick(start) {
  const s0 = Math.round(start * BEAT * RATE);
  for (let i = 0; i < RATE * 0.25; i++) {
    const t = i / RATE;
    const v =
      Math.sin(2 * Math.PI * (50 + 100 * Math.exp(-t * 30)) * t) *
      Math.exp(-t * 12) *
      0.5;
    left[(s0 + i) % LENGTH] += v;
    right[(s0 + i) % LENGTH] += v;
  }
}

// … write the sections: chords, bass, melody, drums …

function writeWav(file) {
  const data = Buffer.alloc(LENGTH * 4);
  for (let i = 0; i < LENGTH; i++) {
    data.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, left[i])) * 32767),
      i * 4
    );
    data.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, right[i])) * 32767),
      i * 4 + 2
    );
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(2, 22); // stereo
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([header, data]));
}

writeWav("music.wav");
console.log(`music.wav ${(LENGTH / RATE).toFixed(1)} s`);
```
