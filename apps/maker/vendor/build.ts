// Builds the shared library files Vite games load (ADR 0007): one minified ES module per library, served by the Worker
// at /vendor/<lib>-<version>.js. A game's own build leaves each specifier below as an import of that URL, so a page
// loads one React and one three, and the phone caches Phaser once for every Phaser game in the feed.
// Each file is cached as immutable from its first deploy, so it is frozen by sha256 (FROZEN): a build that differs
// fails instead of overwriting it, and a library upgrade ships as a new versioned file.
// `pnpm -F maker build:vendor` rebuilds; vendor.test.ts fails when a committed file's bytes change.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { transform } from "esbuild";
import { build } from "vite";
import type { Plugin } from "vite";

const maker = path.join(import.meta.dirname, "..");
const require = createRequire(path.join(maker, "package.json"));

// The exact version apps/maker pins, which is the one installed.
const PINNED: Record<string, string> = JSON.parse(
  readFileSync(path.join(maker, "package.json"), "utf-8")
).devDependencies;
export const version = (pkg: string): string => {
  const pinned = PINNED[pkg];
  if (!pinned || !/^\d+\.\d+\.\d+$/u.test(pinned)) {
    throw new Error(`apps/maker must pin ${pkg} to an exact version`);
  }
  return pinned;
};

// React and React DOM ship CommonJS, whose export names a bundler can't see through `export *`: the entry names each
// one, read by loading the module here. The first module to name an export wins.
const commonJsEntry = (specifiers: string[]) => {
  const seen = new Set(["default", "__esModule"]);
  return specifiers
    .flatMap((specifier, index) => {
      const names = Object.keys(require(specifier)).filter(
        (name) => !seen.has(name) && /^[A-Za-z_$][\w$]*$/u.test(name)
      );
      for (const name of names) {
        seen.add(name);
      }
      return [
        `import m${index} from "${specifier}";`,
        ...(index === 0 ? ["export default m0;"] : []),
        `export const { ${names.join(", ")} } = m${index};`,
      ];
    })
    .join("\n");
};

interface Vendor {
  // The file's name before its version, and the package whose version it carries.
  lib: string;
  pkg: string;
  // The bare specifiers a game's build maps to this file.
  specifiers: string[];
  entry: () => string;
  // The other vendor files' specifiers it imports, by URL.
  siblings: string[];
}

export const VENDORS: Vendor[] = [
  {
    entry: () => commonJsEntry(["react", "react/jsx-runtime"]),
    lib: "react",
    pkg: "react",
    siblings: [],
    specifiers: ["react", "react/jsx-runtime"],
  },
  {
    entry: () => commonJsEntry(["react-dom", "react-dom/client"]),
    lib: "react-dom",
    pkg: "react-dom",
    siblings: ["react"],
    specifiers: ["react-dom", "react-dom/client"],
  },
  {
    entry: () => `export * from "phaser"; export { default } from "phaser";`,
    lib: "phaser",
    pkg: "phaser",
    siblings: [],
    specifiers: ["phaser"],
  },
  {
    entry: () => `export * from "three";`,
    lib: "three",
    pkg: "three",
    siblings: [],
    specifiers: ["three"],
  },
  {
    entry: () => `export * from "@react-three/fiber";`,
    lib: "r3f",
    pkg: "@react-three/fiber",
    siblings: [
      "react",
      "react/jsx-runtime",
      "react-dom",
      "react-dom/client",
      "three",
    ],
    specifiers: ["@react-three/fiber"],
  },
];

export const vendorFile = (vendor: Vendor) =>
  `${vendor.lib}-${version(vendor.pkg)}`;
export const vendorRoute = (vendor: Vendor) =>
  `/vendor/${vendorFile(vendor)}.js`;
// What a game's build passes as its external paths: each specifier to its file's URL.
export const vendorPaths = (): Record<string, string> =>
  Object.fromEntries(
    VENDORS.flatMap((vendor) =>
      vendor.specifiers.map((specifier) => [specifier, vendorRoute(vendor)])
    )
  );

// Committed, as JSON strings the Worker and Node both import.
export const VENDOR_DIR = path.join(maker, "..", "worker", "src", "vendor");
export const servedPath = (route: string) =>
  path.join(VENDOR_DIR, `${path.basename(route, ".js")}.json`);

// Every vendor file the Worker serves, by route, and its sha256. A new file is added here when it is first built.
export const FROZEN: { route: string; sha256: string }[] = [
  {
    route: "/vendor/react-19.3.1.js",
    sha256: "3164409e58db8eed573e8557662f1d090a020d73f89e2172a0563dbe865fd964",
  },
  {
    route: "/vendor/react-dom-19.3.1.js",
    sha256: "999cea5aa54646e35500d908ff221b0b824134a6ee5619de5068daf661fdcf6d",
  },
  {
    route: "/vendor/phaser-4.2.1.js",
    sha256: "a3120a364227b45bf0fc57f7323d562879504af621714fc79c5efd2cae4ed5b6",
  },
  {
    route: "/vendor/three-0.187.0.js",
    sha256: "45e58a0490fa5ff499487f0eb1d0cb52b11d4d4a349e7dc052d2b97494fc0141",
  },
  {
    route: "/vendor/r3f-9.8.2.js",
    sha256: "db8be71d6bc3a8274c550a3bb20fe5b84f6b0459e6852d4b4344781de97be44e",
  },
];

const sha256 = (code: string) =>
  createHash("sha256").update(code).digest("hex");

export const assertFrozen = (code: string, route: string) => {
  const frozen = FROZEN.find((entry) => entry.route === route);
  if (!frozen) {
    throw new Error(
      `${route} is new: add { route: "${route}", sha256: "${sha256(code)}" } to FROZEN`
    );
  }
  if (sha256(code) !== frozen.sha256) {
    throw new Error(
      `${route} is frozen and this build differs from it: serve the change as a new version`
    );
  }
};

// Rolldown turns a CommonJS require() of an external into a runtime require() that throws in a browser. So a sibling
// is never external by its bare name: it resolves to a tiny module that re-exports the sibling's URL, which is
// external, and a CommonJS require of that module gets its namespace, whose names are the sibling's.
const siblings = (vendor: Vendor, paths: Record<string, string>): Plugin => ({
  enforce: "pre",
  load(id) {
    if (!id.startsWith("\0sibling:")) {
      return;
    }
    const specifier = id.slice("\0sibling:".length);
    const url = paths[specifier];
    // three has no default export.
    return specifier === "three"
      ? `export * from "${url}";`
      : `export * from "${url}"; export { default } from "${url}";`;
  },
  name: "hopon-siblings",
  resolveId(id) {
    if (vendor.siblings.includes(id)) {
      return `\0sibling:${id}`;
    }
    if (id.startsWith("/vendor/")) {
      return { external: true, id };
    }
  },
});

// One vendor file's minified code. The entry sits under node_modules so it resolves the packages pnpm installed.
export const compileVendor = async (vendor: Vendor) => {
  const src = path.join(maker, "node_modules", ".hopon-vendor");
  mkdirSync(src, { recursive: true });
  const entry = path.join(src, `${vendor.lib}.js`);
  writeFileSync(entry, vendor.entry());
  const output = await build({
    build: {
      lib: { entry, formats: ["es"] },
      minify: false,
      write: false,
    },
    configFile: false,
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "warn",
    plugins: [siblings(vendor, vendorPaths())],
    root: src,
  });
  const [chunk, ...rest] = [output]
    .flat()
    .flatMap((result) => ("output" in result ? result.output : []));
  if (chunk?.type !== "chunk" || rest.length > 0) {
    throw new Error(`${vendor.lib} built to more than one file`);
  }
  // Library mode keeps an ES build's whitespace; a served file needn't.
  const { code } = await transform(chunk.code, {
    format: "esm",
    minify: true,
    target: "es2022",
  });
  return code;
};

export const buildVendors = async () => {
  mkdirSync(VENDOR_DIR, { recursive: true });
  const built = [];
  for (const vendor of VENDORS) {
    // oxlint-disable-next-line no-await-in-loop -- one Vite build at a time
    const code = await compileVendor(vendor);
    const route = vendorRoute(vendor);
    assertFrozen(code, route);
    writeFileSync(servedPath(route), `${JSON.stringify(code)}\n`);
    built.push({
      bytes: code.length,
      gzipBytes: gzipSync(code).length,
      route,
    });
  }
  return built;
};

if (import.meta.main) {
  console.table(await buildVendors());
}
