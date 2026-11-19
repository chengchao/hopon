// The box's playtest (#115's strict contract), run with cwd = the Draft's workspace by playtest.js. Typechecks
// game.ts and the modules it imports against a narrow .d.ts, builds the game into dist/, serves it as the app would (a
// served runtime under the game CSP), plays a script of taps and swipes in headless Chromium and screenshots the start
// and the end.
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import {
  DOM_SRC,
  domHtml,
  GAME_CSP,
  littlejsHtml,
  RUNTIME_SRC,
} from "./page.ts";

const here = import.meta.dirname;

const ORIGIN = "http://game.hopon";
const VIEWPORT = { height: 640, width: 360 };
const START = { x: 180, y: 320 };
const RANDOM_MS = 10_000;
const OVER_TOO_SOON_MS = 3000;
const SAMPLE_MS = 250;
// How long after the game ends the playtest's end screenshot is taken: long enough for the over screen to draw.
const OVER_SHOWN_MS = 1000;
// CSS transitions and animations run on real time, not the fake clock: the real wait before a screenshot, so a pop or a
// card flip isn't caught half way.
const CSS_SETTLE_MS = 300;
// browser.js, started by the template.
const BROWSER_SERVER = "ws://127.0.0.1:9222/hopon";

export const isDom = () => existsSync("index.html");

// Every module game.ts imports is the game's: their type errors count, the image's own .d.ts files' don't.
const typecheck = async () => {
  const { default: ts } = await import("typescript");
  const program = ts.createProgram(
    [
      "game.ts",
      path.join(here, isDom() ? "dom.d.ts" : "littlejs.d.ts"),
      path.join(here, "assets.d.ts"),
    ],
    {
      allowImportingTsExtensions: true,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      resolveJsonModule: true,
      skipLibCheck: true,
      strict: false,
      target: ts.ScriptTarget.ES2022,
      types: [],
    }
  );
  const cwd = process.cwd();
  const own = (file) => {
    const resolved = path.resolve(file);
    return resolved.startsWith(`${cwd}/`) && !resolved.startsWith(`${here}/`);
  };
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file && own(diagnostic.file.fileName))
    .map((diagnostic) => {
      const { line } = diagnostic.file.getLineAndCharacterOfPosition(
        diagnostic.start ?? 0
      );
      return `${path.relative(cwd, path.resolve(diagnostic.file.fileName))}:${line + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`;
    });
};

// The built game: game.ts and every module, stylesheet and asset it imports, bundled by esbuild into dist/ with the
// page. The bundle is flat ESM with no exports, so it runs as a classic script and game.ts's top-level hooks and
// testVars stay globals; no tree shaking, since nothing in game.ts calls its own hooks. An imported image, sound or font
// becomes a hashed file next to the page, and its import its URL. The harness renders music.opus at `build`, and the
// page names it for the scaffold to fetch; a playtest before that has none.
export const DIST = "dist";
const MUSIC_FILE = "music.opus";
const ASSET_LOADERS = Object.fromEntries(
  [
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".mp3",
    ".ogg",
    ".opus",
    ".woff2",
    ".ttf",
  ].map((extension) => [extension, "file"])
);
const emit = async () => {
  const { build } = await import("esbuild");
  rmSync(DIST, { force: true, recursive: true });
  await build({
    assetNames: "[name]-[hash]",
    bundle: true,
    entryNames: "game",
    entryPoints: ["game.ts"],
    format: "esm",
    loader: { ...ASSET_LOADERS, ".json": "json", ".txt": "text" },
    logLevel: "silent",
    outdir: DIST,
    target: "es2022",
    treeShaking: false,
  });
  // An export (game.ts exporting something, or esbuild wrapping it as CommonJS for a direct eval) would make the
  // bundle a module, which the page can't run as a classic script.
  if (/^export /mu.test(readFileSync(path.join(DIST, "game.js"), "utf-8"))) {
    throw new Error(
      "game.ts must not export anything or use eval(): the page runs it as a plain script"
    );
  }
  const music = existsSync(MUSIC_FILE) ? MUSIC_FILE : undefined;
  if (music) {
    copyFileSync(MUSIC_FILE, path.join(DIST, MUSIC_FILE));
  }
  const files = {
    css: existsSync(path.join(DIST, "game.css")) ? "game.css" : undefined,
    music,
  };
  writeFileSync(
    path.join(DIST, "index.html"),
    isDom()
      ? domHtml(readFileSync("index.html", "utf-8"), files)
      : littlejsHtml(files)
  );
};

// esbuild's errors, or anything else emit threw, as type errors: each with its file and line when it has one.
const emitErrors = (error) =>
  (error.errors ?? [error]).map((item) =>
    item.location
      ? `${item.location.file}:${item.location.line}: ${item.text}`
      : String(item.text ?? item.message ?? item)
  );

// What the page loads, by path: the scaffolds and every built file.
const servedFiles = () => {
  const files = {
    [DOM_SRC]: readFileSync(path.join(here, "dom.js")),
    [RUNTIME_SRC]: readFileSync(path.join(here, "runtime.js")),
  };
  for (const name of readdirSync(DIST)) {
    files[`/${name}`] = readFileSync(path.join(DIST, name));
  }
  files["/"] = files["/index.html"];
  return files;
};

// As the Worker serves a game's files (apps/worker/src/api.ts).
const CONTENT_TYPES = {
  css: "text/css",
  gif: "image/gif",
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  png: "image/png",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  webp: "image/webp",
  woff2: "font/woff2",
};
const contentType = (pathname) =>
  pathname === "/"
    ? "text/html"
    : (CONTENT_TYPES[pathname.split(".").pop()] ?? "application/octet-stream");

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

// Typechecks and emits game.js, then opens the browser: the type errors, or the browser and the served files, with
// the real ms each took.
const prepare = async () => {
  const began = Date.now();
  const typeErrors = existsSync("game.ts") ? await typecheck() : ["no game.ts"];
  if (typeErrors.length > 0) {
    return { typeErrors: typeErrors.slice(0, 10) };
  }
  const checked = Date.now();
  try {
    await emit();
  } catch (error) {
    return { typeErrors: emitErrors(error).slice(0, 10) };
  }
  const emitted = Date.now();
  const files = servedFiles();
  // The box installs Chromium next to this file, and a command may not get the image's ENV.
  if (existsSync(path.join(here, "browsers"))) {
    process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(here, "browsers");
  }
  const { chromium } = await import("playwright-core");
  const browser = await chromium
    .connect(BROWSER_SERVER, { timeout: 2000 })
    .catch(() => chromium.launch());
  return {
    browser,
    files,
    timings: {
      browserMs: Date.now() - emitted,
      emitMs: emitted - checked,
      typecheckMs: checked - began,
    },
  };
};

const TEST_SEED = 115;
const FRAME_MS = 1000 / 60;

// A test's or a playtest's page on a fake clock with a seeded Math.random: it loads in real time, then time stands still and moves only
// as the test says, so the same game plays the same way every run and a minute of play takes no minute to run.
// Runs in the page before its scripts: Math.random seeded, and time frozen until `__hoponAdvance(ms)` moves it, firing
// each animation frame (every 1/60 s) and each timer in order, all in the page.
const fakeTime = ({ seed, frameMs }) => {
  let random = seed;
  Math.random = () => {
    random = (random * 16_807) % 2_147_483_647;
    return random / 2_147_483_647;
  };
  const EPOCH = 1_700_000_000_000;
  let now = 0;
  let ids = 0;
  const timers = new Map();
  let frames = new Map();
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length > 0 ? args : [EPOCH + now]));
    }
    static now() {
      return EPOCH + now;
    }
  };
  performance.now = () => now;
  const schedule =
    (repeat) =>
    (fn, ms = 0, ...args) => {
      ids += 1;
      const every = Math.max(0, Number(ms) || 0);
      timers.set(ids, {
        args,
        at: now + every,
        every: repeat ? Math.max(every, 1) : null,
        fn,
      });
      return ids;
    };
  globalThis.setTimeout = schedule(false);
  globalThis.setInterval = schedule(true);
  globalThis.clearTimeout = (id) => timers.delete(id);
  globalThis.clearInterval = (id) => timers.delete(id);
  globalThis.requestAnimationFrame = (fn) => {
    ids += 1;
    frames.set(ids, fn);
    return ids;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  globalThis.__hoponWaiting = () => frames.size + timers.size;
  globalThis.__hoponAdvance = (ms) => {
    const end = now + ms;
    for (;;) {
      const frameAt = (Math.floor(now / frameMs + 1e-9) + 1) * frameMs;
      let next = null;
      for (const [id, timer] of timers) {
        if (
          !next ||
          timer.at < next[1].at ||
          (timer.at === next[1].at && id < next[0])
        ) {
          next = [id, timer];
        }
      }
      if (next && next[1].at <= Math.min(frameAt, end)) {
        const [id, timer] = next;
        now = Math.max(now, timer.at);
        if (timer.every === null) {
          timers.delete(id);
        } else {
          timer.at += timer.every;
        }
        if (typeof timer.fn === "function") {
          timer.fn(...timer.args);
        }
      } else if (frameAt <= end) {
        now = frameAt;
        const due = frames;
        frames = new Map();
        for (const fn of due.values()) {
          fn(now);
        }
      } else {
        now = end;
        return;
      }
    }
  };
};

const openTestGame = async (browser, files, errors) => {
  const context = await browser.newContext({ viewport: VIEWPORT });
  await context.addInitScript(fakeTime, { frameMs: FRAME_MS, seed: TEST_SEED });
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
      contentType: contentType(url.pathname),
      // The page's origin is opaque (sandbox), so its fetch of its own music is cross-origin, as on the Worker.
      headers: {
        "access-control-allow-origin": "*",
        "content-security-policy": GAME_CSP,
      },
    });
  });
  await page.goto(`${ORIGIN}/`);
  // Loading waits on real events (scripts, images), with the game's time still at 0, until the game has asked for
  // its first frame or timer: a LittleJS game once its engine has started.
  // Polled from here: the page's own timers are the fake ones.
  const loadedBy = Date.now() + 10_000;
  /* oxlint-disable no-await-in-loop, no-undef -- one poll after another; fakeTime's global */
  while (
    (await page.evaluate(() => __hoponWaiting())) === 0 &&
    Date.now() < loadedBy
  ) {
    await sleep(20);
  }
  /* oxlint-enable no-await-in-loop, no-undef */
  // oxlint-disable-next-line no-undef -- fakeTime's global
  const advance = (ms) => page.evaluate((n) => __hoponAdvance(n), ms);
  await advance(500);
  // Each input takes the game time it plays over: a tap holds for two frames, a swipe moves over six.
  const input = async (step) => {
    await page.mouse.move(step.x, step.y);
    await page.mouse.down();
    if (step.type === "swipe") {
      /* oxlint-disable no-await-in-loop -- a finger's moves, one frame apart */
      for (let i = 1; i <= 6; i += 1) {
        await page.mouse.move(
          step.x + ((step.dx ?? 0) * i) / 6,
          step.y + ((step.dy ?? 0) * i) / 6
        );
        await advance(FRAME_MS);
      }
      /* oxlint-enable no-await-in-loop */
    } else {
      await advance(2 * FRAME_MS);
    }
    await page.mouse.up();
    await advance(FRAME_MS);
    return step.type === "swipe" ? 7 * FRAME_MS : 3 * FRAME_MS;
  };
  await input({ type: "tap", ...START });
  await advance(500);
  return { advance, input, page };
};

// What a test's checks read: the game's top-level `testVars`, and the scaffold's score and state.
const testState = () =>
  /* oxlint-disable no-undef -- the game's and the runtime's globals */
  ({
    score: typeof hopon === "object" ? hopon.score : undefined,
    state: typeof hopon === "object" ? hopon.state : undefined,
    vars:
      typeof testVars === "object" && testVars !== null ? { ...testVars } : {},
  });
/* oxlint-enable no-undef */

const describe = ({ vars, score, state }) =>
  `vars ${JSON.stringify(vars)}, score ${score}, state ${state}`;

// The agent's tests (tests.json, ADR 0006): each on a fresh page, its inputs at their times (ms after the start), each
// check's expression evaluated at its time against the state then and `prev`, the same shape at the check before. A test
// stops at its first failed check, or at a check whose expression throws, which is a test error and not the game's. Red
// on a type error or any failed check.
export const runTests = async ({ tests = [] } = {}) => {
  const prepared = await prepare();
  if (prepared.typeErrors) {
    return {
      failures: [],
      ok: false,
      testErrors: [],
      typeErrors: prepared.typeErrors,
    };
  }
  const { browser, files } = prepared;
  const failures = [];
  const testErrors = [];
  const timings = [];
  try {
    // oxlint-disable no-await-in-loop -- one test, input and check after another, in game time
    for (const test of tests) {
      const errors = [];
      const wall = Date.now();
      const { advance, input, page } = await openTestGame(
        browser,
        files,
        errors
      );
      let prev = await page.evaluate(testState);
      // Inputs before checks at the same time; game time `t` moves only forward.
      const events = [
        ...(test.inputs ?? []).map((step) => ({ at: step.at, step })),
        ...(test.checks ?? []).map((check) => ({ at: check.at, check })),
      ].toSorted((a, b) => a.at - b.at || (a.step ? -1 : 1));
      let t = 0;
      for (const event of events) {
        if (event.at > t) {
          await advance(event.at - t);
          t = event.at;
        }
        if (event.step) {
          t += await input(event.step);
        } else {
          const { check } = event;
          const now = await page.evaluate(testState);
          let passed;
          try {
            /* oxlint-disable no-new-func -- the agent's expression, run in the box */
            const expect = new Function(
              "vars",
              "score",
              "state",
              "prev",
              `return (${check.expect});`
            );
            /* oxlint-enable no-new-func */
            passed = Boolean(expect(now.vars, now.score, now.state, prev));
          } catch (error) {
            // An expression that throws is the test's mistake, which no change to the game fixes.
            testErrors.push(
              `test "${test.name}": at ${check.at} ms, ${check.expect} threw ${String(error)}; skipped`
            );
            break;
          }
          if (!passed) {
            failures.push(
              `test "${test.name}": at ${check.at} ms, expected ${check.expect}; got ${describe(now)}; before ${describe(prev)}`
            );
            break;
          }
          prev = now;
        }
      }
      for (const error of errors.slice(0, 3)) {
        failures.push(`test "${test.name}": console error ${error}`);
      }
      timings.push({ gameMs: t, name: test.name, wallMs: Date.now() - wall });
      await page.context().close();
    }
    // oxlint-enable no-await-in-loop
  } finally {
    await browser.close();
  }
  return {
    failures,
    ok: failures.length === 0,
    testErrors,
    timings: { ...prepared.timings, tests: timings },
    typeErrors: [],
  };
};

// Plays the game on the tests' fake clock: load, tap to start, screenshot, run the inputs (game ms after the start tap),
// screenshot the end. When the game ends it stops there, plays no more inputs (a tap would start a new round) and
// screenshots the over screen OVER_SHOWN_MS later.
// Red on a type error, any console error, a clock that didn't run, or identical start and end screenshots.
export const playtest = async ({ inputs = [], ms } = {}) => {
  const prepared = await prepare();
  if (prepared.typeErrors) {
    return { errors: [], ok: false, typeErrors: prepared.typeErrors };
  }
  const { browser, files } = prepared;
  const errors = [];
  try {
    const began = Date.now();
    const { advance, input, page } = await openTestGame(browser, files, errors);
    const loaded = Date.now();
    await sleep(CSS_SETTLE_MS);
    const start = await page.screenshot({ path: "playtest-start.png" });
    const shot = Date.now();
    const until = Math.max(
      ms ?? 0,
      ...inputs.map((step) => step.at + 300),
      3000
    );
    const queue = inputs.toSorted((a, b) => a.at - b.at);
    let t = 0;
    let overAt;
    // oxlint-disable no-await-in-loop -- one input after another, in game time
    for (;;) {
      const { state } = await page.evaluate(pageState);
      if (state === "over") {
        overAt = t;
        await advance(OVER_SHOWN_MS);
        break;
      }
      if (t >= until) {
        break;
      }
      if (queue.length > 0 && queue[0].at <= t) {
        t += await input(queue.shift());
      } else {
        const to = Math.min(until, t + SAMPLE_MS, queue[0]?.at ?? until);
        await advance(to - t);
        t = to;
      }
    }
    // oxlint-enable no-await-in-loop
    const playedAt = Date.now();
    await sleep(CSS_SETTLE_MS);
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
      // Real ms, by phase: where a slow playtest spent its time.
      timings: {
        ...prepared.timings,
        loadMs: loaded - began,
        playMs: playedAt - shot,
        screenshotsMs: shot - loaded + (Date.now() - playedAt),
      },
      typeErrors: [],
      warnings,
      ...state,
    };
  } finally {
    await browser.close();
  }
};
