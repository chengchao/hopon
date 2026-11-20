// Run in the box by src/check.test.ts: `node load.mjs <dist> <csp> [--no-cors]`. Serves a built Vite game over HTTP as
// the Worker would (its files, /hopon/v2.js and the image's copies of the /vendor/ files, under the CSP, with
// Access-Control-Allow-Origin unless --no-cors), loads it in Chromium, taps the start screen and then the game three
// times, and prints what it saw as JSON. It taps as iOS touches: each touch a new identifier, where Playwright's tap
// reuses one. A real server, not Playwright's routing, which skips the CORS check on a module script.
import { once } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { gunzipSync, gzipSync } from "node:zlib";

import { chromium } from "playwright-core";

const [dist, csp, flag] = process.argv.slice(2);
const LOAD_MS = 15_000;
const PLAY_MS = 500;

const own = new Map(
  readdirSync(dist, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const file = path.join(entry.parentPath, entry.name);
      return [`/${path.relative(dist, file)}`, readFileSync(file)];
    })
);
const files = new Map([
  ...own,
  ["/", own.get("/index.html")],
  ["/hopon/v2.js", readFileSync("/opt/hopon/hopon.js")],
  ...Object.entries(
    JSON.parse(readFileSync("/opt/hopon/vendor.json", "utf-8")).files
  ).map(([route, gzip]) => [route, gunzipSync(Buffer.from(gzip, "base64"))]),
]);
const TYPES = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".opus": "audio/ogg",
};

const requested = [];
const server = createServer((request, response) => {
  const { pathname } = new URL(request.url, "http://localhost");
  requested.push(pathname);
  const body = files.get(pathname);
  if (body === undefined) {
    response.writeHead(404).end("not found");
    return;
  }
  response
    .writeHead(200, {
      ...(flag === "--no-cors" ? {} : { "Access-Control-Allow-Origin": "*" }),
      "Content-Security-Policy": csp,
      "Content-Type": TYPES[path.extname(pathname) || ".html"],
    })
    .end(body);
});
await once(server.listen(0, "127.0.0.1"), "listening");

const browser = await chromium
  .connect("ws://127.0.0.1:9222/hopon", { timeout: 2000 })
  .catch(() => chromium.launch());
const page = await browser.newPage({
  hasTouch: true,
  viewport: { height: 640, width: 360 },
});
const cdp = await page.context().newCDPSession(page);
let touches = 0;
const tap = async (x, y) => {
  touches += 1;
  await cdp.send("Input.dispatchTouchEvent", {
    touchPoints: [{ id: touches, x, y }],
    type: "touchStart",
  });
  await cdp.send("Input.dispatchTouchEvent", {
    touchPoints: [],
    type: "touchEnd",
  });
};
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") {
    errors.push(message.text());
  }
});
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
const loaded = await page
  .waitForFunction(() => globalThis.hopon?.loaded, null, { timeout: LOAD_MS })
  .then(() => true)
  .catch(() => false);
const state = () =>
  page.evaluate(() => ({
    origin: globalThis.origin,
    overlay: getComputedStyle(document.querySelector("#hopon-overlay")).display,
    score: hopon.score,
    state: hopon.state,
    testVars: { ...hopon.testVars },
  }));
const before = await state();
await tap(180, 320);
await sleep(PLAY_MS);
const after = await state();
await tap(100, 200);
await sleep(PLAY_MS / 5);
await tap(180, 200);
await sleep(PLAY_MS / 5);
await tap(260, 200);
await sleep(PLAY_MS / 5);
const tapped = await state();
await browser.close();
server.close();
console.log(
  JSON.stringify({
    after,
    before,
    errors,
    loaded,
    // The game's own code and page: what it ships besides the vendor files and its music.
    ownGzipBytes: [...own]
      .filter(([file]) => !file.endsWith(".opus"))
      .reduce((sum, [, bytes]) => sum + gzipSync(bytes).length, 0),
    requested,
    tapped,
  })
);
