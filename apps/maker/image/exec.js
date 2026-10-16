// Runs model-written code in the box: `node exec.js <file.mjs>` with cwd = the Draft's workspace.
// Puts the helpers on globalThis, then imports the file (an ES module, so top-level await works).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const here = import.meta.dirname;

// Same as GAME_CSP in apps/api/src/game.ts.
const GAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts";
const GAME_URL = "http://game.hopon/";

const read = (file) => readFileSync(file, "utf-8");

const write = (file, content) => {
  writeFileSync(file, content);
  return `wrote ${file} (${content.length} chars)`;
};

const patch = (file, oldText, newText) => {
  const text = read(file);
  const count = text.split(oldText).length - 1;
  if (count !== 1) {
    throw new Error(
      `patch: expected exactly one match in ${file}, found ${count}`
    );
  }
  writeFileSync(
    file,
    text.replace(oldText, () => newText)
  );
  return `patched ${file}`;
};

const transpile = async () => {
  if (!existsSync("game.ts")) {
    return;
  }
  const { transform } = await import("esbuild");
  const { code } = await transform(read("game.ts"), {
    loader: "ts",
    target: "es2022",
  });
  writeFileSync("game.js", code);
};

const previewHtml = () => {
  const runtime = read(
    process.env.HOPON_RUNTIME ?? path.join(here, "runtime.js")
  );
  const game = read("game.js").replaceAll("</script", String.raw`<\/script`);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#000;overflow:hidden;touch-action:none}</style></head><body><script>${runtime}</script><script>${game}</script></body></html>`;
};

// The scaffold's and LittleJS's state. Runs in the page; their `let`s and `const hopon` are lexical globals, not
// properties of globalThis, so they are named directly.
const pageState = () => {
  /* oxlint-disable no-undef -- the runtime's globals */
  if (typeof hopon !== "object") {
    return { state: "no runtime", time: 0 };
  }
  return {
    objects: engineObjects.length,
    score: hopon.score,
    state: hopon.state,
    time,
  };
  /* oxlint-enable no-undef */
};

// Plays game.ts (or game.js) for `ms` in headless Chromium at 360×540 under the game CSP, tapping as it goes.
// Writes preview.html and playtest.png; returns console errors and the scaffold's state.
const playtest = async ({ ms = 3000 } = {}) => {
  try {
    await transpile();
  } catch (error) {
    const result = { errors: [`transpile: ${error.message}`], ok: false };
    console.log(JSON.stringify(result));
    return result;
  }
  const html = previewHtml();
  writeFileSync("preview.html", html);
  // The E2B template installs Chromium next to this file; its build-time ENV doesn't reach commands.run.
  if (existsSync(path.join(here, "browsers"))) {
    process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(here, "browsers");
  }
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch();
  const errors = [];
  const warnings = [];
  try {
    const page = await browser.newPage({
      viewport: { height: 540, width: 360 },
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      } else if (
        message.type() === "warning" &&
        !message.text().includes("GL")
      ) {
        warnings.push(message.text());
      }
    });
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.route("**/*", (route) =>
      route.request().url() === GAME_URL
        ? route.fulfill({
            body: html,
            contentType: "text/html",
            headers: { "content-security-policy": GAME_CSP },
          })
        : route.abort()
    );
    await page.goto(GAME_URL);
    await sleep(500);
    await page.mouse.click(180, 400);
    const deadline = Date.now() + ms;
    // Taps and arrow presses one after another, like a player.
    // oxlint-disable no-await-in-loop
    while (Date.now() < deadline) {
      await page.mouse.click(
        40 + Math.random() * 280,
        300 + Math.random() * 200
      );
      await page.keyboard.press(
        Math.random() < 0.5 ? "ArrowLeft" : "ArrowRight"
      );
      await sleep(250);
    }
    // oxlint-enable no-await-in-loop
    await sleep(Math.max(0, deadline - Date.now()));
    await page.screenshot({ path: "playtest.png" });
    const state = await page.evaluate(pageState);
    const result = {
      errors: errors.slice(0, 10),
      ok: errors.length === 0 && state.time > 0,
      screenshot: "playtest.png",
      warnings: warnings.slice(0, 5),
      ...state,
    };
    console.log(JSON.stringify(result));
    return result;
  } finally {
    await browser.close();
  }
};

const minify = async () => {
  await transpile();
  const { transform } = await import("esbuild");
  const { code } = await transform(read("game.js"), { minify: true });
  writeFileSync("game.min.js", code);
  const result = { bytes: code.length, gzipBytes: gzipSync(code).length };
  console.log(JSON.stringify(result));
  return result;
};

Object.assign(globalThis, { minify, patch, playtest, read, write });
await import(pathToFileURL(process.argv[2]).href);
