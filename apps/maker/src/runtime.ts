// Builds image/runtime.js: LittleJS core (release mode: no debug, editor, 3D or plugins) plus the hopon scaffold, and
// image/littlejs.d.ts: the engine's declarations narrowed to what that build defines, as globals, plus hopon's.
// The same bytes go to the Worker, which serves them as /runtime/v1.js, so the box's playtest runs what the phone runs.
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
// Committed, as a JSON string the Worker and Node both import.
export const SERVED_PATH = path.join(
  import.meta.dirname,
  "..",
  "..",
  "worker",
  "src",
  "runtime",
  "v1.json"
);

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

// v1 is cached as immutable, so once people play Games on it (at launch) its bytes must never change: set this to the
// sha256 of v1.json then, and a changed build fails instead of overwriting it. The changed runtime ships as v2.
export const V1_SHA256: string | undefined = undefined;

const sha256 = (code: string) =>
  createHash("sha256").update(code).digest("hex");

export const assertV1Unchanged = (
  code: string,
  frozen: string | undefined = V1_SHA256
) => {
  if (frozen !== undefined && sha256(code) !== frozen) {
    throw new Error(
      "/runtime/v1.js is frozen (V1_SHA256) and this build differs from it: serve the changed runtime as v2"
    );
  }
};

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
  assertV1Unchanged(code);
  writeFileSync(RUNTIME_PATH, code);
  writeFileSync(SERVED_PATH, `${JSON.stringify(code)}\n`);
  writeFileSync(
    DTS_PATH,
    `${narrowDeclarations(source)}\n${readFileSync(path.join(image, "hopon.d.ts"), "utf-8")}`
  );
  return { bytes: code.length, gzipBytes: gzipSync(code).length };
};

if (import.meta.main) {
  console.log("runtime", await buildRuntime());
}
