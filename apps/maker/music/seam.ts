// PROTOTYPE (#129): an objective look at each loop's seam (end → start), to go with listening. Per file:
//   jump: the sample step across the wrap, in multiples of the track's 99th-percentile step (>~3 is a click),
//   stepDb: loudness of the last 100 ms vs the first 100 ms (a big step is a gap or a fade),
//   silence: leading + trailing seconds under -50 dBFS (a gap at the seam).
// node music/seam.ts  (scans music/out/*/*/music*.{wav,webm}; writes seam.json next to each)
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.join(import.meta.dirname, "out");
const RATE = 44_100;

const decode = (file: string) => {
  const raw = execFileSync(
    "ffmpeg",
    [
      "-loglevel",
      "error",
      "-i",
      file,
      "-ac",
      "1",
      "-ar",
      String(RATE),
      "-f",
      "f32le",
      "-",
    ],
    { maxBuffer: 64 * 1024 * 1024 }
  );
  return new Float32Array(new Uint8Array(raw).buffer);
};

const rms = (x: Float32Array) =>
  Math.sqrt(x.reduce((sum, v) => sum + v * v, 0) / Math.max(1, x.length));
const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-6));

export const seam = (file: string) => {
  const x = decode(file);
  const steps = Float32Array.from({ length: x.length - 1 }, (_, i) =>
    Math.abs(x[i + 1] - x[i])
  ).toSorted();
  const p99 = steps[Math.floor(steps.length * 0.99)] || 1e-6;
  const win = RATE / 10;
  const quiet = 10 ** (-50 / 20);
  let lead = 0;
  while (lead < x.length && Math.abs(x[lead]) < quiet) {
    lead += 1;
  }
  let trail = 0;
  while (trail < x.length && Math.abs(x[x.length - 1 - trail]) < quiet) {
    trail += 1;
  }
  return {
    jump: Math.round((Math.abs(x[0] - (x.at(-1) ?? 0)) / p99) * 10) / 10,
    silence: Math.round(((lead + trail) / RATE) * 1000) / 1000,
    stepDb:
      Math.round(
        (db(rms(x.subarray(0, win))) - db(rms(x.subarray(-win)))) * 10
      ) / 10,
  };
};

if (import.meta.main) {
  for (const game of readdirSync(OUT).filter((name) => !name.includes("."))) {
    for (const run of readdirSync(path.join(OUT, game))) {
      const dir = path.join(OUT, game, run);
      const result: Record<string, unknown> = {};
      for (const suffix of ["", "-edit"]) {
        const file = ["wav", "webm"]
          .map((ext) => path.join(dir, `music${suffix}.${ext}`))
          // A: the runtime's raw samples; B and C: the Opus that ships.
          .find(
            (candidate) =>
              existsSync(candidate) &&
              (run.startsWith("a")
                ? candidate.endsWith(".wav")
                : candidate.endsWith(".webm"))
          );
        if (file) {
          result[suffix || "first"] = seam(file);
        }
      }
      writeFileSync(path.join(dir, "seam.json"), JSON.stringify(result));
      console.log(game, run, JSON.stringify(result));
    }
  }
}
