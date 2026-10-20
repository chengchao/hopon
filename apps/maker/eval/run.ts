// pnpm -F maker eval <command> [options]: the Maker's model eval (#115). Run by hand, never in CI: it costs money and
// needs keys (apps/maker/.env). See eval/README.md.
import {
  copyFileSync,
  rmSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import type { Thinking } from "../src/coder.ts";
import { CANDIDATES } from "../src/models.ts";
import { buildRuntime } from "../src/runtime.ts";
import {
  CODER_JOBS,
  OUT,
  readRevision,
  REVISIONS,
  runCoder,
  SMOKE_JOBS,
} from "./coder.ts";
import type { CoderJob, CoderRecord } from "./coder.ts";
import { runE2E } from "./e2e.ts";
import {
  coderStats,
  quantile,
  readRecords,
  report,
  talkerStats,
} from "./report.ts";
import type { TalkerRecord } from "./talker.ts";
import { CHATS, runTalker } from "./talker.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    chats: { type: "string" },
    // e2e: the pair to run.
    coder: { default: "claude-haiku-5-5", type: "string" },
    concurrency: { default: "6", type: "string" },
    // e2e: the designer's effort, when the Talker has one.
    designer: { type: "string" },
    jobs: { type: "string" },
    models: { type: "string" },
    runs: { default: "3", type: "string" },
    sweep: { default: "sweep", type: "string" },
    talker: { default: "claude-haiku-5-5", type: "string" },
    // e2e: the Talker's effort.
    "talker-thinking": { default: "low", type: "string" },
    // The Coder's effort; the Talker always runs at low.
    thinking: { default: "low", type: "string" },
  },
});
const command = positionals[0] ?? "help";
const sweepDir = path.join(OUT, values.sweep);
const CALIBRATION = path.join(import.meta.dirname, "calibration.json");
const FREEZE_MODEL = "claude-sonnet-5-5";
const FREEZE_TRIES = 3;
const SMOKE_MEDIAN_S = 120;
const BLIND_RUNS = 20;

const list = (value: string | undefined, all: string[]) =>
  value ? value.split(",").filter(Boolean) : all;
const models = (fallback: string[]) => list(values.models, fallback);

// A fixed number of tasks in flight; E2B Hobby allows 20 running boxes.
const pool = async <T>(tasks: (() => Promise<T>)[], size: number) => {
  const results: T[] = [];
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      // oxlint-disable-next-line no-await-in-loop -- one task at a time per worker
      results[index] = await (tasks[index] as () => Promise<T>)();
    }
  };
  await Promise.all(Array.from({ length: size }, worker));
  return results;
};

const version = (name: string) =>
  (
    JSON.parse(
      readFileSync(
        path.join(
          import.meta.dirname,
          "..",
          "node_modules",
          name,
          "package.json"
        ),
        "utf-8"
      )
    ) as { version: string }
  ).version;

const versions = () =>
  Object.fromEntries(
    [
      "@earendil-works/pi-ai",
      "@earendil-works/pi-coding-agent",
      "@earendil-works/pi-durable",
      "e2b",
      "littlejsengine",
      "playwright-core",
      "typescript",
    ].map((name) => [name, version(name)])
  );

const line = (record: CoderRecord) =>
  `${record.model} ${record.job}#${record.run}: ${record.pass ? "pass" : "FAIL"} green=${record.finalGreen} steps=${record.steps} $${record.cost.toFixed(4)} ${record.seconds.toFixed(0)}s${record.reason ? ` (${record.reason})` : ""}`;

// The gateway refuses requests when Unified Billing runs short (402). Such a run says nothing about the model: its
// result is discarded, and the sweep stops so nothing else is spent into a refusal. The next sweep reruns it.
const BILLING = /Insufficient unified billing/u;
let billingStopped = false;
const refusedForBilling = (dir: string, record: unknown) => {
  if (!BILLING.test(JSON.stringify(record))) {
    return false;
  }
  rmSync(dir, { force: true, recursive: true });
  if (!billingStopped) {
    billingStopped = true;
    console.log(
      "BILLING: the gateway refused a request (402); stopping the sweep"
    );
  }
  return true;
};

const sweepCoder = async (
  jobs: CoderJob[],
  modelIds: string[],
  runs: number,
  judge = true
) => {
  writeFileSync(
    path.join(sweepDir, "versions.json"),
    JSON.stringify(versions(), null, 2)
  );
  const tasks = modelIds.flatMap((modelId) =>
    jobs.flatMap((job) =>
      Array.from({ length: runs }, (_, run) => async () => {
        const dir = path.join(
          sweepDir,
          "coder",
          modelId,
          `${job.id}-${run + 1}`
        );
        if (billingStopped) {
          return null;
        }
        if (existsSync(path.join(dir, "result.json"))) {
          return JSON.parse(
            readFileSync(path.join(dir, "result.json"), "utf-8")
          ) as CoderRecord;
        }
        // A lost box or a failed request skips the run, with no result.json, so the next sweep retries it.
        try {
          const record = await runCoder({
            dir,
            job,
            judge,
            modelId,
            run: run + 1,
            thinking: values.thinking as Thinking,
          });
          if (refusedForBilling(dir, record)) {
            return null;
          }
          console.log(line(record));
          return record;
        } catch (error) {
          console.log(
            `${modelId} ${job.id}#${run + 1}: SKIPPED ${String(error).slice(0, 200)}`
          );
          return null;
        }
      })
    )
  );
  return await pool(tasks, Number(values.concurrency));
};

const contactSheet = async (records: CoderRecord[]) => {
  const cells = records
    .toSorted((a, b) =>
      `${a.job}${a.model}`.localeCompare(`${b.job}${b.model}`)
    )
    .map((record) => {
      const image = path.join(
        sweepDir,
        "coder",
        record.model,
        `${record.job}-${record.run}`,
        "end.png"
      );
      const src = existsSync(image)
        ? `data:image/png;base64,${readFileSync(image).toString("base64")}`
        : "";
      return `<figure style="margin:0;width:120px;font:10px sans-serif"><div style="width:120px;height:213px;background:#222">${src ? `<img src="${src}" width="120" height="213">` : ""}</div><figcaption style="color:${record.pass ? "#060" : "#b00"}">${record.job}#${record.run}<br>${record.model}</figcaption></figure>`;
    })
    .join("");
  const html = `<!doctype html><body style="margin:8px;display:flex;flex-wrap:wrap;gap:6px;width:1600px">${cells}</body>`;
  writeFileSync(path.join(sweepDir, "contact-sheet.html"), html);
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { height: 800, width: 1616 },
  });
  await page.setContent(html);
  await page.screenshot({
    fullPage: true,
    path: path.join(sweepDir, "contact-sheet.png"),
  });
  await browser.close();
};

const commands: Record<string, () => Promise<void> | void> = {
  // Blind scoring for the owner: 20 judged Coder runs, spread over the models, without model names.
  blind: () => {
    const records = report(sweepDir, CALIBRATION).coderRuns.filter(
      (record) =>
        record.judge && !("error" in record.judge) && record.finalGreen
    );
    const byModel = Object.groupBy(records, (record) => record.model);
    const perModel = Math.ceil(BLIND_RUNS / Object.keys(byModel).length);
    // Deterministic spread: every n-th run of each model.
    const chosen = Object.values(byModel)
      .flatMap((runs = []) =>
        runs
          .filter(
            (_, index) =>
              index % Math.max(1, Math.floor(runs.length / perModel)) === 0
          )
          .slice(0, perModel)
      )
      .slice(0, BLIND_RUNS)
      .toSorted((a, b) => a.job.localeCompare(b.job));
    const dir = path.join(sweepDir, "blind");
    mkdirSync(dir, { recursive: true });
    const key: Record<string, string> = {};
    const cards = chosen.map((record, index) => {
      const id = `b${String(index + 1).padStart(2, "0")}`;
      const runDir = path.join(
        sweepDir,
        "coder",
        record.model,
        `${record.job}-${record.run}`
      );
      key[id] = path.relative(path.join(sweepDir, "coder"), runDir);
      for (const file of [
        "start.png",
        "end.png",
        "preview.html",
        "music.opus",
      ]) {
        if (existsSync(path.join(runDir, file))) {
          copyFileSync(
            path.join(runDir, file),
            path.join(dir, `${id}-${file}`)
          );
        }
      }
      const job = CODER_JOBS.find((candidate) => candidate.id === record.job);
      const edit = record.kind === "edit";
      if (edit && job?.base) {
        writeFileSync(
          path.join(dir, `${id}-original.html`),
          readFileSync(path.join(REVISIONS, job.base, "preview.html"))
        );
      }
      const input = (item: string) =>
        `<label>${item} <input type="number" min="1" max="5" name="${id}.${item}"></label>`;
      return `<section><h2>${id} · ${edit ? "edit" : "new game"}</h2><p><b>${job?.spec.title}</b>: ${job?.spec.brief}${job?.spec.music ? `<br>Music: ${job.spec.music}` : ""}</p><p><img src="${id}-start.png" width="180"> <img src="${id}-end.png" width="180"></p><p><a href="${id}-preview.html" target="_blank">Play it</a>${edit ? ` · <a href="${id}-original.html" target="_blank">The original</a>` : ""}${existsSync(path.join(runDir, "music.opus")) ? ` · <audio controls loop src="${id}-music.opus"></audio>` : ""}</p><p>${input("spec")} ${input("playable")} ${edit ? input("edit") : ""}</p></section>`;
    });
    writeFileSync(path.join(dir, "key.json"), JSON.stringify(key, null, 2));
    writeFileSync(
      path.join(dir, "index.html"),
      `<!doctype html><meta charset="utf-8"><title>Blind scores</title><style>body{font:16px system-ui;max-width:760px;margin:24px auto;padding:0 16px}section{border-top:1px solid #ccc;padding:8px 0}input{width:3em}</style><h1>Score 20 games, 1–5</h1><p><b>spec</b>: does it read as the spec? <b>playable</b>: clear goal, controls work by tap or swipe, doesn't end before you can act, everything readable. <b>edit</b>: did the change do what was asked and break nothing else? 5 fully, 4 small flaws, 3 partly, 2 barely, 1 not at all.</p>${cards.join("")}<p><button id="copy">Copy scores</button></p><pre id="out"></pre><script>document.getElementById("copy").onclick=()=>{const s={};for(const i of document.querySelectorAll("input")){if(!i.value)continue;const[id,item]=i.name.split(".");(s[id]??={})[item]=Number(i.value)}const t=JSON.stringify(s,null,1);document.getElementById("out").textContent=t;navigator.clipboard?.writeText(t)}</script>`
    );
    console.log(
      `open ${path.join(dir, "index.html")}; then: pnpm -F maker eval calibrate --sweep ${values.sweep} < scores.json`
    );
  },
  // Turns the blind page's scores (stdin) into eval/calibration.json, keyed by run.
  calibrate: async () => {
    const key = JSON.parse(
      readFileSync(path.join(sweepDir, "blind", "key.json"), "utf-8")
    ) as Record<string, string>;
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const scores = JSON.parse(
      Buffer.concat(chunks).toString("utf-8")
    ) as Record<string, Record<string, number>>;
    const rows = Object.entries(scores).map(([id, items]) => ({
      run: key[id],
      ...items,
    }));
    writeFileSync(CALIBRATION, `${JSON.stringify(rows, null, 2)}\n`);
    console.log(report(sweepDir, CALIBRATION).markdown);
  },
  coder: async () => {
    const jobs = CODER_JOBS.filter((job) =>
      list(
        values.jobs,
        CODER_JOBS.map((each) => each.id)
      ).includes(job.id)
    );
    await sweepCoder(
      jobs,
      models(Object.keys(CANDIDATES)),
      Number(values.runs)
    );
    console.log(report(sweepDir, CALIBRATION).markdown);
  },
  // The real Talker driving the real Coder through the scripted chats; every built game is judged.
  e2e: async () => {
    const pair = `${values.talker}-${values["talker-thinking"]}${values.designer ? `+designer-${values.designer}` : ""}+${values.coder}-${values.thinking}`;
    const chats = CHATS.filter((chat) =>
      list(
        values.chats,
        CHATS.map((each) => each.id)
      ).includes(chat.id)
    );
    const tasks = chats.flatMap((chat) =>
      Array.from({ length: Number(values.runs) }, (_, run) => async () => {
        const dir = path.join(sweepDir, "e2e", pair, `${chat.id}-${run + 1}`);
        if (billingStopped || existsSync(path.join(dir, "result.json"))) {
          return;
        }
        try {
          const { builds, talker } = await runE2E({
            chat,
            coderModel: values.coder,
            designer: values.designer as Thinking | undefined,
            dir,
            run: run + 1,
            talkerModel: values.talker,
            talkerThinking: values["talker-thinking"] as Thinking,
            thinking: values.thinking as Thinking,
          });
          if (refusedForBilling(dir, { builds, talker })) {
            return;
          }
          console.log(
            `${pair} ${chat.id}#${run + 1}: talker ${talker.pass ? "pass" : "FAIL"}, builds ${builds.filter((build) => build.pass).length}/${builds.length} pass`
          );
        } catch (error) {
          console.log(
            `${pair} ${chat.id}#${run + 1}: SKIPPED ${String(error).slice(0, 200)}`
          );
        }
      })
    );
    await pool(tasks, Number(values.concurrency));
    const root = path.join(sweepDir, "e2e", pair);
    const builds = readRecords<CoderRecord>(root).filter(
      (record) => record.agent === "coder"
    );
    const talkers = readRecords<TalkerRecord>(root).filter(
      (record) => record.agent === "talker"
    );
    const summary = {
      builds: coderStats(builds),
      pair,
      talker: talkerStats(talkers),
    };
    writeFileSync(
      path.join(root, "summary.json"),
      JSON.stringify(summary, null, 2)
    );
    console.log(JSON.stringify(summary, null, 2));
  },
  // The edit jobs' starting Revisions, built once with Sonnet and checked by the owner (preview.html in each).
  freeze: async () => {
    const bases = [
      ...new Set(CODER_JOBS.flatMap((job) => (job.base ? [job.base] : []))),
    ];
    for (const base of bases) {
      if (existsSync(path.join(REVISIONS, base))) {
        continue;
      }
      const job = CODER_JOBS.find(
        (candidate) => candidate.id === base
      ) as CoderJob;
      for (let tries = 1; tries <= FREEZE_TRIES; tries += 1) {
        const dir = path.join(OUT, "freeze", `${base}-${tries}`);
        // oxlint-disable-next-line no-await-in-loop -- one try after another
        const record = await runCoder({
          dir,
          job,
          modelId: FREEZE_MODEL,
          run: tries,
        });
        console.log(line(record));
        if (record.pass) {
          mkdirSync(path.join(REVISIONS, base), { recursive: true });
          for (const file of [
            "game.ts",
            "game.js",
            "index.html",
            "preview.html",
          ]) {
            if (existsSync(path.join(dir, file))) {
              cpSync(path.join(dir, file), path.join(REVISIONS, base, file));
            }
          }
          break;
        }
      }
    }
    for (const base of bases) {
      console.log(`${base}: ${Object.keys(readRevision(base)).join(", ")}`);
    }
  },
  help: () => {
    console.log(
      readFileSync(path.join(import.meta.dirname, "README.md"), "utf-8")
    );
  },
  report: async () => {
    const { coderRuns, markdown } = report(sweepDir, CALIBRATION);
    if (coderRuns.length > 0) {
      await contactSheet(coderRuns);
    }
    console.log(markdown);
  },
  // Kimi before the full sweep: the 5 spike jobs once, no judge. A model passes when images in tool
  // results work (every run sent screenshots and no request failed) and its median turn is ≤ 120 s.
  smoke: async () => {
    const jobs = CODER_JOBS.filter((job) => SMOKE_JOBS.includes(job.id));
    const results = await sweepCoder(jobs, models(["kimi-k3"]), 1, false);
    const records = results.filter((record) => record !== null);
    for (const [model, runs = []] of Object.entries(
      Object.groupBy(records, (record) => record.model)
    )) {
      const images = runs.every(
        (run) => run.imagesSent > 0 && run.errors.length === 0
      );
      const medianS = quantile(
        runs.map((run) => run.seconds),
        0.5
      );
      const green = runs.filter((run) => run.finalGreen).length;
      console.log(
        `${model}: images in tool results ${images ? "ok" : "FAIL"}, median ${medianS.toFixed(0)} s ${medianS <= SMOKE_MEDIAN_S ? "ok" : "FAIL"}, ${green}/${runs.length} green, $${runs.reduce((sum, run) => sum + run.cost, 0).toFixed(3)} → ${images && medianS <= SMOKE_MEDIAN_S ? "joins the sweep" : "dropped"}`
      );
    }
  },
  talker: async () => {
    writeFileSync(
      path.join(sweepDir, "versions.json"),
      JSON.stringify(versions(), null, 2)
    );
    const chats = CHATS.filter((chat) =>
      list(
        values.chats,
        CHATS.map((each) => each.id)
      ).includes(chat.id)
    );
    const tasks = models(Object.keys(CANDIDATES)).flatMap((modelId) =>
      chats.flatMap((chat) =>
        Array.from({ length: Number(values.runs) }, (_, run) => async () => {
          const dir = path.join(
            sweepDir,
            "talker",
            modelId,
            `${chat.id}-${run + 1}`
          );
          if (billingStopped || existsSync(path.join(dir, "result.json"))) {
            return;
          }
          const record = await runTalker({ chat, dir, modelId, run: run + 1 });
          if (refusedForBilling(dir, record)) {
            return;
          }
          console.log(
            `${modelId} ${chat.id}#${run + 1}: ${record.pass ? "pass" : "FAIL"} behaviour=${record.behaviourOk} brevity=${record.brevityOk} $${record.cost.toFixed(4)}`
          );
        })
      )
    );
    await pool(tasks, Number(values.concurrency));
    console.log(report(sweepDir, CALIBRATION).markdown);
  },
};

// A box whose connection drops can reject a stream nobody awaits; that run is already lost, the sweep goes on.
process.on("unhandledRejection", (error) => {
  console.log(`unhandled: ${String(error).slice(0, 200)}`);
});

const action = commands[command];
if (!action) {
  throw new Error(
    `unknown command ${command}; one of ${Object.keys(commands).join(", ")}`
  );
}
mkdirSync(sweepDir, { recursive: true });
await buildRuntime();
await action();
