// The box's start command and PID 1 (#113): a Chromium server, so playtests start warm; playtest connects to it and
// falls back to launching its own. The typecheck, the transpile and one render of the runtime run here once too, warm
// for the first job. A model's bash can end the server at any moment, startup too, so this never exits, which would
// stop the box, and starts the server again whenever it ends.
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { transform } from "esbuild";
import { chromium } from "playwright-core";
import ts from "typescript";

process.on("uncaughtException", (error) => console.error(error));
process.on("unhandledRejection", (error) => console.error(error));

const warm = async (endpoint) => {
  await transform("const a: number = 1;", { loader: "ts" });
  ts.getPreEmitDiagnostics(
    ts.createProgram(["/opt/hopon/littlejs.d.ts"], {
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
      noEmit: true,
      types: [],
    })
  );
  const browser = await chromium.connect(endpoint);
  const context = await browser.newContext({
    viewport: { height: 640, width: 360 },
  });
  const page = await context.newPage();
  await page.setContent(
    `<script>${readFileSync("/opt/hopon/runtime.js", "utf-8")}</script><script>function gameRender(){drawRect(vec2(0,0),vec2(5,5),RED)}</script>`
  );
  await sleep(1500);
  await page.mouse.click(180, 320);
  await sleep(500);
  await page.screenshot();
  await browser.close();
};

let warmed = false;
// oxlint-disable no-await-in-loop -- one server at a time, for the box's life
for (;;) {
  try {
    const server = await chromium.launchServer({ port: 9222, wsPath: "hopon" });
    const ended = once(server.process(), "exit");
    if (!warmed) {
      warmed = true;
      await warm(server.wsEndpoint()).catch((error) => console.error(error));
    }
    await ended;
  } catch (error) {
    console.error(error);
  }
  // The port can stay bound a moment after the server is killed.
  await sleep(500);
}
// oxlint-enable no-await-in-loop
