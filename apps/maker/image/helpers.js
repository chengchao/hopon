// The box's playtest (#115's strict contract), run with cwd = the Draft's workspace by playtest.js. Typechecks the
// game against a narrow .d.ts, builds it into dist/, serves it as the app would (a served scaffold under the game CSP),
// plays a script of taps and swipes in headless Chromium and screenshots the start and the end. A workspace with a
// vite.config.ts is a Vite game (ADR 0007): `vite build` with its libraries left as imports of the Worker's /vendor/
// files. Any other is a LittleJS or plain-DOM game.ts, bundled by esbuild.
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
import { stripVTControlCharacters } from "node:util";
import { gunzipSync } from "node:zlib";

import {
  DOM_SRC,
  domHtml,
  GAME_CSP,
  HOPON_SRC,
  littlejsHtml,
  RUNTIME_SRC,
  viteHtml,
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
// The one file every Vite project has and no game.ts game does.
export const isVite = () => existsSync("vite.config.ts");

// The diagnostics of the game's own files: their type errors count, the image's .d.ts files' and the libraries' don't.
const ownErrors = (ts, diagnostics) => {
  const cwd = process.cwd();
  const own = (file) => {
    const resolved = path.resolve(file);
    return resolved.startsWith(`${cwd}/`) && !resolved.startsWith(`${here}/`);
  };
  return diagnostics
    .filter((diagnostic) => diagnostic.file && own(diagnostic.file.fileName))
    .map((diagnostic) => {
      const { line } = diagnostic.file.getLineAndCharacterOfPosition(
        diagnostic.start ?? 0
      );
      return `${path.relative(cwd, path.resolve(diagnostic.file.fileName))}:${line + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`;
    });
};

// A Vite game is typechecked as `tsc -p .` would, by its own tsconfig.json, with the scaffold's and the assets'
// declarations from the image; its libraries' types resolve from the image's /node_modules.
const typecheckVite = async () => {
  const { default: ts } = await import("typescript");
  if (!existsSync("tsconfig.json")) {
    return ["tsconfig.json is missing"];
  }
  const configErrors = [];
  const parsed = ts.getParsedCommandLineOfConfigFile(
    "tsconfig.json",
    { noEmit: true },
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) =>
        configErrors.push(diagnostic),
    }
  );
  const errors = [...configErrors, ...(parsed?.errors ?? [])];
  if (!parsed || errors.length > 0) {
    return errors.map(
      (diagnostic) =>
        `tsconfig.json: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`
    );
  }
  // Vite's template's tsconfig.json holds only "references", which `tsc -p .` doesn't follow without --build.
  if (parsed.fileNames.length === 0) {
    return [
      'tsconfig.json: it includes no files, so nothing is typechecked: give it the compilerOptions and "include": ["src"] in place of "references"',
    ];
  }
  const program = ts.createProgram(
    [
      ...parsed.fileNames,
      path.join(here, "hopon-v1.d.ts"),
      path.join(here, "assets.d.ts"),
    ],
    parsed.options
  );
  return ownErrors(ts, ts.getPreEmitDiagnostics(program));
};

// Every module game.ts imports is the game's.
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
  return ownErrors(ts, ts.getPreEmitDiagnostics(program));
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
    ".wav",
    ".glb",
    ".gltf",
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

// The Worker's vendor files (image/vendor.json, which src/runtime.ts writes from the Worker's own copies): each route's
// gzip, and the specifiers a game's build maps to them.
const vendor = () =>
  JSON.parse(readFileSync(path.join(here, "vendor.json"), "utf-8"));
// The package a bare specifier names: `react/jsx-runtime` is react's.
const packageOf = (specifier) =>
  specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");
// three's addons import three by name, so they build into the game and use the shared three.
const ADDONS = "/node_modules/three/examples/";

// A Vite game: `vite build` with the game's vite.config.ts under the harness's settings, which win. Each vendored
// library stays an import of its /vendor/ URL, and the page and its files land flat in dist/, as the Worker serves a
// game's files by name. An imported file stays a file, however small, since the CSP refuses fetch() a data: URL. A
// library's code built into the game anyway (a deep import such as react/jsx-dev-runtime) would be a second copy beside
// the shared one, so it fails. The music goes next to the page, named on the scaffold's tag as in the other pages.
const emitVite = async () => {
  const { build } = await import("vite");
  const { paths } = vendor();
  const built = await build({
    assetsInclude: ["**/*.glb", "**/*.gltf"],
    base: "./",
    build: {
      assetsDir: "",
      assetsInlineLimit: 0,
      emptyOutDir: true,
      outDir: DIST,
      rolldownOptions: { external: Object.keys(paths), output: { paths } },
    },
    logLevel: "silent",
    root: process.cwd(),
  });
  const vendored = Object.keys(paths).map(packageOf);
  const bundled = new Set(
    [built]
      .flat()
      .flatMap((result) => result.output)
      .flatMap((file) => (file.type === "chunk" ? file.moduleIds : []))
      .filter((id) => !id.includes(ADDONS))
      .flatMap((id) =>
        vendored.filter((pkg) => id.includes(`/node_modules/${pkg}/`))
      )
  );
  if (bundled.size > 0) {
    throw new Error(
      `${[...bundled].join(", ")} built into the game: import only ${Object.keys(
        paths
      )
        .filter((specifier) => bundled.has(packageOf(specifier)))
        .join(", ")}, which load the shared /vendor/ files`
    );
  }
  const music = existsSync(MUSIC_FILE) ? MUSIC_FILE : undefined;
  if (music) {
    copyFileSync(MUSIC_FILE, path.join(DIST, MUSIC_FILE));
  }
  const page = path.join(DIST, "index.html");
  writeFileSync(page, viteHtml(readFileSync(page, "utf-8"), { music }));
};

// esbuild's and Vite's errors, or anything else emit threw, as type errors: each with its file and line when it has
// one.
const emitError = (item) => {
  if (item.location) {
    return `${item.location.file}:${item.location.line}: ${item.text}`;
  }
  if (item.loc?.file) {
    return `${path.relative(process.cwd(), item.loc.file)}:${item.loc.line}: ${item.message}`;
  }
  return String(item.text ?? item.message ?? item);
};
const emitErrors = (error) =>
  (error.errors ?? [error]).map((item) =>
    stripVTControlCharacters(emitError(item))
  );

// Where the page is served, as the Worker serves a Game's under /games/<id>/ and a Draft's under a longer path: a file
// the page names by an absolute path, which the Worker doesn't serve, is a 404 here too.
const GAME_DIR = "/games/0/";

// What the page loads, by path: the scaffolds at the root and every file at the top of dist/ under GAME_DIR, all the
// Worker serves of a Revision. A Vite game's page also loads its scaffold and the vendor files; the others' don't, so
// one that tries gets a 404.
const servedFiles = (vite) => {
  const files = {
    [DOM_SRC]: readFileSync(path.join(here, "dom.js")),
    [RUNTIME_SRC]: readFileSync(path.join(here, "runtime.js")),
  };
  if (vite) {
    files[HOPON_SRC] = readFileSync(path.join(here, "hopon.js"));
    for (const [route, gzip] of Object.entries(vendor().files)) {
      files[route] = gunzipSync(Buffer.from(gzip, "base64"));
    }
  }
  for (const entry of readdirSync(DIST, { withFileTypes: true })) {
    if (entry.isFile()) {
      files[`${GAME_DIR}${entry.name}`] = readFileSync(
        path.join(DIST, entry.name)
      );
    }
  }
  return files;
};

// As the Worker serves a game's files (apps/worker/src/api.ts).
const CONTENT_TYPES = {
  css: "text/css",
  gif: "image/gif",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
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
  wasm: "application/wasm",
  wav: "audio/wav",
  webp: "image/webp",
  woff2: "font/woff2",
};
const contentType = (pathname) =>
  CONTENT_TYPES[pathname.split(".").pop()] ?? "application/octet-stream";

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

// Typechecks and builds the game into dist/, then opens the browser: the type errors, or the browser and the served
// files, with the real ms each took.
const prepare = async () => {
  const began = Date.now();
  const vite = isVite();
  let typeErrors = ["no game.ts"];
  if (vite) {
    typeErrors = await typecheckVite();
  } else if (existsSync("game.ts")) {
    typeErrors = await typecheck();
  }
  if (typeErrors.length > 0) {
    return { typeErrors: typeErrors.slice(0, 10) };
  }
  const checked = Date.now();
  try {
    await (vite ? emitVite() : emit());
  } catch (error) {
    return { typeErrors: emitErrors(error).slice(0, 10) };
  }
  const emitted = Date.now();
  const files = servedFiles(vite);
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
    vite,
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
  // React's scheduler runs its work in a MessageChannel task, which the fake clock doesn't hold, so a state set from a
  // timer would render on real time. It takes setImmediate first when there is one.
  globalThis.setImmediate = (fn, ...args) =>
    globalThis.setTimeout(fn, 0, ...args);
  globalThis.clearImmediate = globalThis.clearTimeout;
  globalThis.requestAnimationFrame = (fn) => {
    ids += 1;
    frames.set(ids, fn);
    return ids;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  globalThis.__hoponWaiting = () => frames.size + timers.size;
  // The microtasks a callback queued run before the next timer or frame, as in a browser: React schedules a render from
  // one. A few turns of the microtask queue, not a real task, so no real event (a load, a fetch) lands mid-advance; a
  // real task per callback also made 10 s of a Phaser game's play take a fifth longer.
  // Eight turns are a margin, not a bound: a longer await chain between callbacks runs a few ticks late.
  /* oxlint-disable no-await-in-loop, unicorn/consistent-function-scoping -- one callback after another, in game time;
     fakeTime runs in the page as one function */
  const settle = async () => {
    for (let turn = 0; turn < 8; turn += 1) {
      await Promise.resolve();
    }
  };
  globalThis.__hoponAdvance = async (ms) => {
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
          await settle();
        }
      } else if (frameAt <= end) {
        now = frameAt;
        const due = frames;
        frames = new Map();
        for (const fn of due.values()) {
          fn(now);
          await settle();
        }
      } else {
        now = end;
        return;
      }
    }
  };
  /* oxlint-enable no-await-in-loop, unicorn/consistent-function-scoping */
};

// How long a page has to load, in real time.
const LOAD_MS = 10_000;
const NOT_READY = `the game didn't call hopon.ready() within ${LOAD_MS / 1000} s of loading`;

const openTestGame = async ({ browser, files, vite }, errors) => {
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
  await page.goto(`${ORIGIN}${GAME_DIR}index.html`);
  // oxlint-disable-next-line no-undef -- fakeTime's global
  const advance = (ms) => page.evaluate((n) => __hoponAdvance(n), ms);
  // Loading waits on real events (scripts, images), polled from here since the page's own timers are the fake ones.
  // A game.ts game's time stays at 0 until it has asked for its first frame or timer: a LittleJS game once its engine
  // has started. A Vite game's scaffold asks for frames at once, and an engine may wait on frames or timers before it
  // draws (r3f measures its canvas on one), so its time moves a frame per poll until it calls hopon.ready().
  const loadedBy = Date.now() + LOAD_MS;
  let ready = !vite;
  /* oxlint-disable no-await-in-loop, no-undef -- one poll after another; the page's globals */
  while (Date.now() < loadedBy) {
    if (vite) {
      ready = await page.evaluate(() => globalThis.hopon?.loaded === true);
      if (ready) {
        break;
      }
      await advance(FRAME_MS);
    } else if ((await page.evaluate(() => __hoponWaiting())) > 0) {
      break;
    }
    await sleep(vite ? 10 : 20);
  }
  /* oxlint-enable no-await-in-loop, no-undef */
  await advance(500);
  // Each input takes the game time it plays over: a tap holds for two frames, a swipe moves over six. A pause or a
  // resume is the feed's message, which takes none.
  const input = async (step) => {
    if (step.type === "pause" || step.type === "resume") {
      await page.evaluate(
        (type) =>
          dispatchEvent(
            new MessageEvent("message", { data: JSON.stringify({ type }) })
          ),
        step.type
      );
      return 0;
    }
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
  return { advance, input, notReady: ready ? [] : [NOT_READY], page };
};

// What a test's checks read: the game's top-level `testVars` (a Vite game's hopon.testVars, since a module's
// top-level isn't global), and the scaffold's score and state.
const testState = () => {
  /* oxlint-disable no-undef -- the game's and the runtime's globals */
  const scaffold = typeof hopon === "object" ? hopon : undefined;
  const vars =
    typeof testVars === "object" && testVars !== null
      ? testVars
      : scaffold?.testVars;
  return {
    score: scaffold?.score,
    state: scaffold?.state,
    vars: { ...vars },
  };
  /* oxlint-enable no-undef */
};

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
  const { browser } = prepared;
  const failures = [];
  const testErrors = [];
  const timings = [];
  try {
    // oxlint-disable no-await-in-loop -- one test, input and check after another, in game time
    for (const test of tests) {
      const errors = [];
      const wall = Date.now();
      const { advance, input, notReady, page } = await openTestGame(
        prepared,
        errors
      );
      failures.push(
        ...notReady.map((error) => `test "${test.name}": ${error}`)
      );
      // Each later test's page would wait out LOAD_MS again.
      if (notReady.length > 0) {
        await page.context().close();
        break;
      }
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
  const { browser } = prepared;
  const errors = [];
  try {
    const began = Date.now();
    const { advance, input, notReady, page } = await openTestGame(
      prepared,
      errors
    );
    errors.push(...notReady);
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
