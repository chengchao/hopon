// Builds image/runtime.js: LittleJS core (release mode: no debug, editor, 3D or plugins) plus the hopon scaffold.
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

export const buildRuntime = async () => {
  const source = [
    ...ENGINE_FILES.map((file) =>
      readFileSync(path.join(engine, file), "utf-8")
    ),
    readFileSync(path.join(image, "scaffold.js"), "utf-8"),
  ].join("\n");
  const { code } = await transform(source, { minify: true, target: "es2022" });
  writeFileSync(RUNTIME_PATH, code);
  return { bytes: code.length, gzipBytes: gzipSync(code).length };
};
