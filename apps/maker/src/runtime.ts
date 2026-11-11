// Builds image/runtime.js: LittleJS core (release mode: no debug, editor, 3D or plugins) plus the hopon scaffold, and
// image/littlejs.d.ts: the engine's declarations narrowed to what that build defines, as globals, plus hopon's.
// The same bytes go to the Worker, which serves them as /runtime/v3.js, so the box's playtest runs what the phone runs.
// It also copies the plain-DOM scaffold (image/dom.js) to the Worker as is, served as /dom/v3.js. The versions before
// them stay frozen in their JSON for the Games that load them (FROZEN).
// `pnpm -F maker build:runtime` rebuilds; runtime.test.ts fails when the Worker's copy is stale.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { transform } from "esbuild";

const image = path.join(import.meta.dirname, "..", "image");
const engine = path.join(
  path.dirname(
    createRequire(import.meta.url).resolve("littlejsengine/package.json")
  ),
  "src"
);

// The release build's file order from littlejsengine/src/engineBuild.mjs, minus enginePluginFiles.
const ENGINE_FILES = [
  "engine.js",
  "engineRelease.js",
  "engineMath.js",
  "engineUtilities.js",
  "engineSettings.js",
  "engineObject.js",
  "engineDraw.js",
  "engineInput.js",
  "engineAudio.js",
  "engineTileLayer.js",
  "engineParticles.js",
  "engineWebGL.js",
  "engineLogo.js",
];

export const RUNTIME_PATH = path.join(image, "runtime.js");
const DTS_PATH = path.join(image, "littlejs.d.ts");
// Committed, as JSON strings the Worker and Node both import.
const served = (file: string) =>
  path.join(import.meta.dirname, "..", "..", "worker", "src", "runtime", file);
export const SERVED_PATH = served("v3.json");
export const DOM_SERVED_PATH = served("dom-v3.json");

// One top-level declaration of the engine's d.ts: its JSDoc plus the declaration, which ends where the next one starts.
const DECLARATION =
  /^ {4}export (?:declare )?(?:abstract )?(?<kind>function|let|const|class|namespace|type|interface) (?<name>\w+)/u;

// game.ts is a classic script, so the engine's module declarations become globals. Types and interfaces always stay;
// values stay only when the release build defines them, so a plugin's API fails the typecheck instead of at runtime.
const narrowDeclarations = (source: string) => {
  const defined = new Set(
    [
      ...source.matchAll(/^(?:function|class|let|const|var) (?<name>\w+)/gmu),
    ].map((match) => match.groups?.name)
  );
  const lines = readFileSync(
    path.join(engine, "..", "dist", "littlejs.d.ts"),
    "utf-8"
  ).split("\n");
  // A block starts at a top-level JSDoc, or at a declaration that has none.
  const blocks: string[][] = [[]];
  let declared = false;
  for (const line of lines.slice(1, -1)) {
    const isDeclaration = DECLARATION.test(line);
    if (line.startsWith("    /**") || (isDeclaration && declared)) {
      blocks.push([]);
      declared = false;
    }
    blocks.at(-1)?.push(line);
    declared ||= isDeclaration;
  }
  const kept = blocks.filter((block) => {
    const match = block.map((line) => DECLARATION.exec(line)).find(Boolean);
    const { kind = "", name = "" } = match?.groups ?? {};
    return ["type", "interface"].includes(kind) || defined.has(name);
  });
  return kept
    .flat()
    .map((line) =>
      line
        .replace(/^ {4}export (?:declare )?/u, "declare ")
        .replace(/^ {4}/u, "")
    )
    .join("\n");
};

// Every scaffold is cached as immutable, and a phone or a published Game may hold it from its first deploy, so each is
// frozen from then: its sha256 here, and a changed build fails instead of overwriting it. A change ships as the next
// version. /runtime/v2.js and /dom/v1.js went unfrozen while Games played on them, until 2026-11-11. (Runtime v1 was #137's, changed by #146 before any Creator's Game used it, so
// it's no longer served.)
// The versions no build writes any more, by route: their committed JSON and its sha256.
export const FROZEN = [
  {
    path: served("v2.json"),
    route: "/runtime/v2.js",
    sha256: "62fcf7bebd3e45b654fa5b1607e3a96a0f2cf8d374432a6ec76750681ecd2839",
  },
  {
    path: served("dom-v1.json"),
    route: "/dom/v1.js",
    sha256: "d070bfc4ba9b6d36dca6a5daa4e9ebf0002d84c217d97dfe5b2983a584ca96a0",
  },
  {
    path: served("dom-v2.json"),
    route: "/dom/v2.js",
    sha256: "e8b4c0d868ab19b3449945937492cf512de074e1e3660a3e8c2bab01e5c81d7f",
  },
];
export const V3_SHA256 =
  "05830d99f269e095ee3dbff2f0ca212b4d5f12aadc2abf329936384bf4f37c3b";
export const DOM_V3_SHA256 =
  "b14590b09313ae982295c753b075ef1a5a622b1db33440657c86a81470557458";

const sha256 = (code: string) =>
  createHash("sha256").update(code).digest("hex");

export const assertUnchanged = (
  code: string,
  frozen: string,
  route: string
) => {
  if (sha256(code) !== frozen) {
    throw new Error(
      `${route} is frozen and this build differs from it: serve the change as its next version`
    );
  }
};

export const domScaffold = () =>
  readFileSync(path.join(image, "dom.js"), "utf-8");

const runtimeSource = () =>
  [
    ...ENGINE_FILES.map((file) =>
      readFileSync(path.join(engine, file), "utf-8")
    ),
    readFileSync(path.join(image, "scaffold.js"), "utf-8"),
  ].join("\n");

export const compileRuntime = async (source = runtimeSource()) => {
  const { code } = await transform(source, { minify: true, target: "es2022" });
  return code;
};

export const buildRuntime = async () => {
  const source = runtimeSource();
  const code = await compileRuntime(source);
  assertUnchanged(code, V3_SHA256, "/runtime/v3.js");
  const dom = domScaffold();
  assertUnchanged(dom, DOM_V3_SHA256, "/dom/v3.js");
  writeFileSync(RUNTIME_PATH, code);
  writeFileSync(SERVED_PATH, `${JSON.stringify(code)}\n`);
  writeFileSync(DOM_SERVED_PATH, `${JSON.stringify(dom)}\n`);
  writeFileSync(
    DTS_PATH,
    `${narrowDeclarations(source)}\n${readFileSync(path.join(image, "hopon.d.ts"), "utf-8")}`
  );
  return { bytes: code.length, gzipBytes: gzipSync(code).length };
};

if (import.meta.main) {
  console.log("runtime", await buildRuntime());
}
