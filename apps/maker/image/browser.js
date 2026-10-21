// The template's start command (#113): a Chromium server that runs before the snapshot, so every box from the
// template starts with it warm. playtest connects to it and falls back to launching its own. The typecheck, the
// transpile and one render of the runtime run here once too, so the snapshot holds them warm.
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { transform } from "esbuild";
import { chromium } from "playwright-core";
import ts from "typescript";

const server = await chromium.launchServer({ port: 9222, wsPath: "hopon" });
await transform("const a: number = 1;", { loader: "ts" });
ts.getPreEmitDiagnostics(
  ts.createProgram(["/opt/hopon/littlejs.d.ts"], {
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    noEmit: true,
    types: [],
  })
);
const browser = await chromium.connect(server.wsEndpoint());
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
