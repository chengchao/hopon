// pnpm -F maker eval <command> [options]: the Maker's model eval (#115). Run by hand, never in CI: it costs money and
// needs keys (apps/maker/.env). See eval/README.md.
import {
  copyFileSync,
  rmSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { CANDIDATES } from "../src/models.ts";
import { buildRuntime } from "../src/runtime.ts";
import { CODER_JOBS, OUT, REVISIONS } from "./coder.ts";
import type { CoderRecord } from "./coder.ts";
import { runPreviewE2E, signIn } from "./preview.ts";
import { coderStats, readRecords, report, talkerStats } from "./report.ts";
import type { TalkerRecord } from "./talker.ts";
import { CHATS, runTalker } from "./talker.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    chats: { type: "string" },
    concurrency: { default: "6", type: "string" },
    models: { type: "string" },
    // e2e: the Worker Preview's URL the chats run on.
    preview: { type: "string" },
    runs: { default: "3", type: "string" },
    sweep: { default: "sweep", type: "string" },
  },
});
const command = positionals[0] ?? "help";
const sweepDir = path.join(OUT, values.sweep);
const CALIBRATION = path.join(import.meta.dirname, "calibration.json");
const BLIND_RUNS = 20;

const list = (value: string | undefined, all: string[]) =>
  value ? value.split(",").filter(Boolean) : all;
const models = (fallback: string[]) => list(values.models, fallback);

// A fixed number of tasks in flight.
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
      "@earendil-works/pi-durable",
      "littlejsengine",
      "playwright-core",
      "typescript",
    ].map((name) => [name, version(name)])
  );

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
      for (const file of ["start.png", "end.png", "preview.html"]) {
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
      return `<section><h2>${id} · ${edit ? "edit" : "new game"}</h2><p><b>${job?.spec.title}</b>: ${job?.spec.brief}${job?.spec.music ? `<br>Music: ${job.spec.music}` : ""}</p><p><img src="${id}-start.png" width="180"> <img src="${id}-end.png" width="180"></p><p><a href="${id}-preview.html" target="_blank">Play it</a>${edit ? ` · <a href="${id}-original.html" target="_blank">The original</a>` : ""}</p><p>${input("spec")} ${input("playable")} ${edit ? input("edit") : ""}</p></section>`;
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
  // The scripted chats on a Worker Preview, through the real Talker and Coder; every built game is judged.
  e2e: async () => {
    const { preview } = values;
    if (!preview) {
      throw new Error("e2e runs on a Worker Preview: pass --preview <url>");
    }
    const token = await signIn();
    const pair = `preview-${new URL(preview).host}`;
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
          const { builds, talker } = await runPreviewE2E({
            base: preview,
            chat,
            dir,
            run: run + 1,
            token,
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

// A dropped connection can reject a stream nobody awaits; that run is already lost, the sweep goes on.
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
