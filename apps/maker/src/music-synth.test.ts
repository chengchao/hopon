import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const SKILL = new URL(
  "../agent-home/.agents/skills/music-synth/SKILL.md",
  import.meta.url
);
const SKELETON = /```js\n(?<code>[\s\S]*?)```/u;
const SECTIONS = "// … write the sections: chords, bass, melody, drums …\n";
const MIN_S = 20;
const MAX_S = 40;
const MAX_PEAK = 0.9;
const RATE = 44_100;
const HEADER_BYTES = 44;
const FRAME_BYTES = 4;
const FULL_SCALE = 32_768;

const SCORE = `for (let bar = 0; bar < BARS; bar++) {
  for (let b = 0; b < 4; b++) {
    if (b % 2 === 0) kick(bar * 4 + b);
    else snare(bar * 4 + b, 0.25, 0.2);
    hat(bar * 4 + b + 0.5, 0.06, b === 3);
    note({ start: bar * 4 + b, midi: 36, beats: 0.9, wave: "triangle", volume: 0.2 });
    note({ start: bar * 4 + b + 0.5, midi: 79, beats: 0.4, wave: "pulse", duty: 0.25, pan: 0.5, echo: 0.4, vibrato: 0.15 });
  }
  note({ start: bar * 4, midi: 60, beats: 4, wave: "saw", volume: 0.05, attack: 0.3, release: 0.8 });
  note({ start: bar * 4, midi: 64, beats: 4, wave: "sine", volume: 0.05, pan: -0.5 });
}
note({ start: BARS * 4 - 1, midi: 84, beats: 3, wave: "saw", volume: 0.1, echo: 0.5 });
`;

const render = () => {
  const skeleton = SKELETON.exec(readFileSync(SKILL, "utf-8"))?.groups?.code;
  assert.ok(skeleton, "the skill has a js skeleton");
  assert.ok(
    skeleton.includes(SECTIONS),
    "the skeleton has a place for the sections"
  );
  const dir = mkdtempSync(path.join(tmpdir(), "music-synth-"));
  writeFileSync(path.join(dir, "music.mjs"), skeleton.replace(SECTIONS, SCORE));
  execFileSync(process.execPath, ["music.mjs"], { cwd: dir });
  const wav = readFileSync(path.join(dir, "music.wav"));
  const frames = (wav.length - HEADER_BYTES) / FRAME_BYTES;
  const left = Float64Array.from(
    { length: frames },
    (_, i) => wav.readInt16LE(HEADER_BYTES + i * FRAME_BYTES) / FULL_SCALE
  );
  return { left, wav };
};

test("the music-synth skeleton renders a 44.1 kHz stereo loop in range that wraps without a jump", () => {
  const { left, wav } = render();
  assert.equal(wav.readUInt16LE(22), 2);
  assert.equal(wav.readUInt32LE(24), RATE);

  const seconds = left.length / RATE;
  assert.ok(seconds >= MIN_S && seconds <= MAX_S, `${seconds} s`);

  let peak = 0;
  for (const v of left) {
    peak = Math.max(peak, Math.abs(v));
  }
  assert.ok(peak > 0.5 && peak < MAX_PEAK, `peak ${peak}`);

  const steps = left
    .slice(1)
    .map((v, i) => Math.abs(v - left[i]))
    .toSorted();
  const typical = steps[Math.floor(steps.length * 0.99)];
  const seam = Math.abs(left[0] - (left.at(-1) ?? Number.NaN));
  assert.ok(seam <= typical, `seam ${seam}, 99th-percentile step ${typical}`);
});
