// The box's playtest (#115's strict contract), run with cwd = the Draft's workspace by playtest.js. Typechecks
// game.ts against a narrow .d.ts, emits game.js, serves the game as the app would (a served runtime under the game
// CSP), plays a script of taps and swipes in headless Chromium and screenshots the start and the end.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const here = import.meta.dirname;

// The served-runtime CSP: scripts and media from the game's own origin only.
const GAME_CSP =
  "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data: blob:; media-src 'self' data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts";
const ORIGIN = "http://game.hopon";
const VIEWPORT = { height: 640, width: 360 };
const START = { x: 180, y: 320 };
const RANDOM_MS = 10_000;
const OVER_TOO_SOON_MS = 3000;
const SAMPLE_MS = 250;
// browser.js, started by the template.
const BROWSER_SERVER = "ws://127.0.0.1:9222/hopon";

// The LittleJS page the app serves: a stub loading the runtime and the game.
const LITTLEJS_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#000;overflow:hidden;touch-action:none}</style></head><body><script src="/runtime/v1.js"></script><script src="/game.js"></script></body></html>`;

export const isDom = () => existsSync("index.html");

const typecheck = async () => {
  const { default: ts } = await import("typescript");
  const program = ts.createProgram(
    ["game.ts", path.join(here, isDom() ? "dom.d.ts" : "littlejs.d.ts")],
    {
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
      noEmit: true,
      skipLibCheck: true,
      strict: false,
      target: ts.ScriptTarget.ES2022,
      types: [],
    }
  );
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === "game.ts")
    .map((diagnostic) => {
      const { line } = diagnostic.file.getLineAndCharacterOfPosition(
        diagnostic.start ?? 0
      );
      return `game.ts:${line + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`;
    });
};

const emit = async () => {
  const { transform } = await import("esbuild");
  const { code } = await transform(readFileSync("game.ts", "utf-8"), {
    loader: "ts",
    target: "es2022",
  });
  writeFileSync("game.js", code);
};

// Park–Miller: the same "random" script on every game and every run.
const seeded = (seed) => {
  let state = seed;
  return () => {
    state = (state * 16_807) % 2_147_483_647;
    return state / 2_147_483_647;
  };
};

// Random taps and swipes over 10 s, one every ~300 ms, anywhere below the score corner.
export const randomScript = () => {
  const random = seeded(115);
  const inputs = [];
  for (let at = 200; at < RANDOM_MS; at += 200 + Math.round(random() * 200)) {
    const x = Math.round(20 + random() * 320);
    const y = Math.round(80 + random() * 540);
    if (random() < 0.6) {
      inputs.push({ at, type: "tap", x, y });
    } else {
      const angle = Math.floor(random() * 4) * (Math.PI / 2);
      inputs.push({
        at,
        dx: Math.round(Math.cos(angle) * 90),
        dy: Math.round(Math.sin(angle) * 90),
        type: "swipe",
        x,
        y,
      });
    }
  }
  return { inputs, ms: RANDOM_MS };
};

// The scaffolds' state; runs in the page, where their `let`s and `const hopon` are lexical globals.
const pageState = () => {
  /* oxlint-disable no-undef -- the runtime's globals */
  if (typeof hopon !== "object") {
    return { clock: 0, state: "no runtime" };
  }
  return {
    clock: typeof hoponClock === "function" ? hoponClock() : time,
    score: hopon.score,
    state: hopon.state,
  };
  /* oxlint-enable no-undef */
};

const play = async (page, input) => {
  if (input.type === "swipe") {
    await page.mouse.move(input.x, input.y);
    await page.mouse.down();
    await page.mouse.move(
      input.x + (input.dx ?? 0),
      input.y + (input.dy ?? 0),
      {
        steps: 6,
      }
    );
    await page.mouse.up();
  } else {
    await page.mouse.click(input.x, input.y);
  }
};

// Plays the game: load, tap to start, screenshot, run the inputs (ms after the start tap), screenshot.
// Red on a type error, any console error, a clock that didn't run, or identical start and end screenshots.
export const playtest = async ({ inputs = [], ms } = {}) => {
  const typeErrors = existsSync("game.ts") ? await typecheck() : ["no game.ts"];
  if (typeErrors.length > 0) {
    return { errors: [], ok: false, typeErrors: typeErrors.slice(0, 10) };
  }
  await emit();
  const files = {
    "/": isDom() ? readFileSync("index.html") : LITTLEJS_HTML,
    "/dom.js": readFileSync(path.join(here, "dom.js")),
    "/game.js": readFileSync("game.js"),
    "/runtime/v1.js": readFileSync(path.join(here, "runtime.js")),
  };
  // The E2B template installs Chromium next to this file; its build-time ENV doesn't reach commands.run.
  if (existsSync(path.join(here, "browsers"))) {
    process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(here, "browsers");
  }
  const { chromium } = await import("playwright-core");
  const browser = await chromium
    .connect(BROWSER_SERVER, { timeout: 2000 })
    .catch(() => chromium.launch());
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      const body = url.origin === ORIGIN ? files[url.pathname] : undefined;
      if (body === undefined) {
        return route.fulfill({ body: "not found", status: 404 });
      }
      return route.fulfill({
        body,
        contentType: url.pathname.endsWith(".js")
          ? "text/javascript"
          : "text/html",
        headers: { "content-security-policy": GAME_CSP },
      });
    });
    await page.goto(`${ORIGIN}/`);
    await sleep(500);
    await play(page, { type: "tap", ...START });
    await sleep(500);
    const start = await page.screenshot({ path: "playtest-start.png" });
    const begun = Date.now();
    const deadline =
      begun + Math.max(ms ?? 0, ...inputs.map((input) => input.at + 300), 3000);
    let overAt;
    const queue = inputs.toSorted((a, b) => a.at - b.at);
    // oxlint-disable no-await-in-loop -- one input after another, like a player
    while (Date.now() < deadline) {
      while (queue.length > 0 && queue[0].at <= Date.now() - begun) {
        await play(page, queue.shift());
      }
      const { state } = await page.evaluate(pageState);
      if (state === "over") {
        overAt ??= Date.now() - begun;
      }
      await sleep(SAMPLE_MS);
    }
    // oxlint-enable no-await-in-loop
    const end = await page.screenshot({ path: "playtest-end.png" });
    const state = await page.evaluate(pageState);
    const identical = start.equals(end);
    const warnings =
      overAt !== undefined && overAt < OVER_TOO_SOON_MS
        ? [`state "over" ${(overAt / 1000).toFixed(1)} s after the start`]
        : [];
    return {
      errors: [
        ...errors.slice(0, 10),
        ...(state.clock > 0 ? [] : ["the clock didn't run"]),
        ...(identical ? ["start and end screenshots are identical"] : []),
      ],
      identical,
      ok: errors.length === 0 && state.clock > 0 && !identical,
      overAt,
      screenshots: ["playtest-start.png", "playtest-end.png"],
      typeErrors: [],
      warnings,
      ...state,
    };
  } finally {
    await browser.close();
  }
};
