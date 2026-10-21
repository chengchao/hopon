// The sweep's report (#115): per model and agent, pass rate, steps, dollars and seconds, the latency limits, the
// winner by #115's rule (cheapest median $ per turn among the models that clear), the turn limits from the winner's
// p95, and the judge's calibration against the owner's blind scores.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { CoderRecord } from "./coder.ts";
import type { TalkerRecord } from "./talker.ts";

const PASS_BAR = 0.9;
const CODER_MEDIAN_S = 60;
const CODER_P90_S = 120;
const MUSIC_EXTRA_S = 30;
// #115 set 2 s and 8 s; the owner loosened them on 2026-10-20 so the Talker can run at high effort, which writes the
// design specs that build best (94% against ~80% at low effort in the end-to-end runs).
const TALKER_FIRST_TOKEN_S = 3;
const TALKER_REPLY_S = 10;
const MAX_STEPS = 12;
const MAX_SECONDS = 300;
const CALIBRATION_OFF_BY = 1;
const CALIBRATION_MAX_OFF = 4;

export const quantile = (values: number[], q: number) => {
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  if (sorted.length === 0) {
    return Number.NaN;
  }
  // Nearest rank: the value at or above q of the runs, so p95 of 90 runs is the 86th.
  return (
    sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)] ??
    Number.NaN
  );
};
const median = (values: number[]) => quantile(values, 0.5);

export const readRecords = <T>(dir: string): T[] =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name === "result.json")
        .map(
          (entry) =>
            JSON.parse(
              readFileSync(path.join(entry.parentPath, entry.name), "utf-8")
            ) as T
        )
    : [];

const groupBy = <T>(items: T[], key: (item: T) => string) => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  }
  return groups;
};

export const coderStats = (runs: CoderRecord[]) => {
  // Music jobs get +30 s: measured against the same limits after taking it off.
  const latency = runs.map(
    (run) => run.seconds - (run.music ? MUSIC_EXTRA_S : 0)
  );
  const stats = {
    firstGreen: runs.filter((run) => run.firstGreen).length / runs.length,
    medianCost: median(runs.map((run) => run.cost)),
    medianPlaytests: median(runs.map((run) => run.playtests)),
    medianSeconds: median(latency),
    medianSteps: median(runs.map((run) => run.steps)),
    p90Seconds: quantile(latency, 0.9),
    p95SecondsRaw: quantile(
      runs.map((run) => run.seconds),
      0.95
    ),
    p95Steps: quantile(
      runs.map((run) => run.steps),
      0.95
    ),
    passRate: runs.filter((run) => run.pass).length / runs.length,
    runs: runs.length,
    totalCost: runs.reduce((sum, run) => sum + run.cost, 0),
    warnings: runs.filter((run) => run.warnings.length > 0).length,
  };
  return {
    ...stats,
    clears:
      stats.passRate >= PASS_BAR &&
      stats.medianSeconds <= CODER_MEDIAN_S &&
      stats.p90Seconds <= CODER_P90_S,
  };
};

export const talkerStats = (runs: TalkerRecord[]) => {
  const turns = runs.flatMap((run) => run.turns);
  const stats = {
    medianCost: median(turns.map((turn) => turn.cost)),
    medianFirstTokenS: median(
      turns.map((turn) => (turn.firstTokenMs ?? Number.NaN) / 1000)
    ),
    medianReplyS: median(turns.map((turn) => turn.replyMs / 1000)),
    p95ReplyS: quantile(
      turns.map((turn) => turn.replyMs / 1000),
      0.95
    ),
    passRate: runs.filter((run) => run.pass).length / runs.length,
    runs: runs.length,
    totalCost: runs.reduce((sum, run) => sum + run.cost, 0),
    turns: turns.length,
  };
  return {
    ...stats,
    // "The full reply ≤ 8 s": every turn's, read as the median like the first token's.
    clears:
      stats.passRate >= PASS_BAR &&
      stats.medianFirstTokenS <= TALKER_FIRST_TOKEN_S &&
      stats.medianReplyS <= TALKER_REPLY_S,
  };
};

const pick = <S extends { clears: boolean; medianCost: number }>(
  stats: Map<string, S>
) =>
  [...stats.entries()]
    .filter(([, value]) => value.clears)
    .toSorted(([, a], [, b]) => a.medianCost - b.medianCost)[0]?.[0];

const roundUpTo = (value: number, step: number) =>
  Math.ceil(value / step) * step;

interface Calibration {
  run: string;
  spec: number;
  playable: number;
  edit?: number;
}

const calibrate = (coderDir: string, calibrationFile: string) => {
  if (!existsSync(calibrationFile)) {
    return;
  }
  const owner = JSON.parse(
    readFileSync(calibrationFile, "utf-8")
  ) as Calibration[];
  const rows = owner.map((scores) => {
    const file = path.join(coderDir, scores.run, "result.json");
    const record = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf-8")) as CoderRecord)
      : undefined;
    const judge =
      record?.judge && !("error" in record.judge) ? record.judge : undefined;
    const items = (["spec", "playable", "edit"] as const).flatMap((item) => {
      const ownerScore = scores[item];
      const judgeScore = judge?.[item]?.score;
      return ownerScore === undefined || judgeScore === undefined
        ? []
        : [{ item, judge: judgeScore, owner: ownerScore }];
    });
    return {
      items,
      off: items.some(
        (item) => Math.abs(item.judge - item.owner) > CALIBRATION_OFF_BY
      ),
      run: scores.run,
    };
  });
  const off = rows.filter((row) => row.off).length;
  return { off, ok: off <= CALIBRATION_MAX_OFF, rows };
};

const pct = (value: number) => `${Math.round(value * 100)}%`;
const usd = (value: number) => `$${value.toFixed(4)}`;
const sec = (value: number) => `${value.toFixed(1)} s`;

export const report = (sweepDir: string, calibrationFile: string) => {
  const coderDir = path.join(sweepDir, "coder");
  const coderRuns = readRecords<CoderRecord>(coderDir);
  const talkerRuns = readRecords<TalkerRecord>(path.join(sweepDir, "talker"));
  const coder = new Map(
    [...groupBy(coderRuns, (run) => run.model)].map(([model, runs]) => [
      model,
      coderStats(runs),
    ])
  );
  const talker = new Map(
    [...groupBy(talkerRuns, (run) => run.model)].map(([model, runs]) => [
      model,
      talkerStats(runs),
    ])
  );
  const coderWinner = pick(coder);
  const talkerWinner = pick(talker);
  const winnerStats = coderWinner ? coder.get(coderWinner) : undefined;
  const limits = winnerStats && {
    seconds: Math.min(MAX_SECONDS, roundUpTo(winnerStats.p95SecondsRaw, 10)),
    steps: Math.min(MAX_STEPS, Math.ceil(winnerStats.p95Steps)),
  };
  const calibration = calibrate(coderDir, calibrationFile);
  const result = {
    calibration,
    coder: Object.fromEntries(coder),
    coderLimits: limits,
    coderWinner,
    talker: Object.fromEntries(talker),
    talkerWinner,
  };

  const lines = [
    "## Coder",
    "",
    "| model | runs | pass | first green | median steps | p95 steps | median $ | median s | p90 s | p95 s (raw) | clears |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...[...coder].map(
      ([model, s]) =>
        `| ${model} | ${s.runs} | ${pct(s.passRate)} | ${pct(s.firstGreen)} | ${s.medianSteps} | ${s.p95Steps} | ${usd(s.medianCost)} | ${sec(s.medianSeconds)} | ${sec(s.p90Seconds)} | ${sec(s.p95SecondsRaw)} | ${s.clears ? "yes" : "no"} |`
    ),
    "",
    `Seconds are job start to Revision ready, music jobs less 30 s. Winner: ${coderWinner ?? "none clears"}.${limits ? ` Turn limits from its p95: ${limits.steps} steps, ${limits.seconds} s.` : ""}`,
    "",
    "## Talker",
    "",
    "| model | chats | turns | pass | median first token | median reply | p95 reply | median $ / turn | clears |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...[...talker].map(
      ([model, s]) =>
        `| ${model} | ${s.runs} | ${s.turns} | ${pct(s.passRate)} | ${sec(s.medianFirstTokenS)} | ${sec(s.medianReplyS)} | ${sec(s.p95ReplyS)} | ${usd(s.medianCost)} | ${s.clears ? "yes" : "no"} |`
    ),
    "",
    `Reply time excludes the stub build. Winner: ${talkerWinner ?? "none clears"}.`,
    "",
    "## Judge calibration",
    "",
    calibration
      ? `${calibration.off} of ${calibration.rows.length} owner-scored runs have the judge more than ${CALIBRATION_OFF_BY} point off on an item: ${calibration.ok ? "within" : "OVER"} the limit of ${CALIBRATION_MAX_OFF}.`
      : "No owner scores yet (eval/calibration.json).",
  ];
  writeFileSync(
    path.join(sweepDir, "report.json"),
    JSON.stringify(result, null, 2)
  );
  writeFileSync(path.join(sweepDir, "report.md"), `${lines.join("\n")}\n`);
  return { coderRuns, markdown: lines.join("\n"), result };
};
