// Builds image/runtime.js: LittleJS core (release mode: no debug, editor, 3D or plugins) plus the hopon scaffold, and
// image/littlejs.d.ts: the engine's declarations narrowed to what that build defines, as globals, plus hopon's.
// The same bytes go to the Worker, which serves them as /runtime/v2.js, so the box's playtest runs what the phone runs.
// It also copies the plain-DOM scaffold (image/dom.js) to the Worker as is, served as /dom/v1.js.
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
export const SERVED_PATH = served("v2.json");
export const DOM_SERVED_PATH = served("dom-v1.json");

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

// Both are cached as immutable, so once people play Games on them (at launch) their bytes must never change: set these
// to the sha256 of v2.json's and dom-v1.json's strings then, and a changed build fails instead of overwriting them. A
// change then ships as the next version. (Runtime v1 was #137's, changed by #146 before any Creator's Game used it, so
// it's no longer served.)
export const V2_SHA256: string | undefined = undefined;
export const DOM_V1_SHA256: string | undefined = undefined;

const sha256 = (code: string) =>
  createHash("sha256").update(code).digest("hex");

export const assertUnchanged = (
  code: string,
  frozen: string | undefined,
  route: string
) => {
  if (frozen !== undefined && sha256(code) !== frozen) {
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
  assertUnchanged(code, V2_SHA256, "/runtime/v2.js");
  const dom = domScaffold();
  assertUnchanged(dom, DOM_V1_SHA256, "/dom/v1.js");
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
