import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { text } from "node:stream/consumers";
import { test } from "node:test";

import {
  assertFrozen,
  compileVendor,
  FROZEN,
  servedCode,
  servedPath,
  VENDOR_DIR,
  VENDORS,
  vendorRoute,
  version,
} from "../vendor/build.ts";

const served = (route: string) => servedCode(route) ?? "";

test("the Worker serves each vendor file as it was frozen", () => {
  const files = readdirSync(VENDOR_DIR).toSorted();
  assert.deepEqual(
    files,
    FROZEN.map(({ route }) => path.basename(servedPath(route))).toSorted(),
    "every committed vendor file is frozen, and every frozen one committed"
  );
  for (const { route } of FROZEN) {
    assertFrozen(served(route), route);
  }
});

test("the vendor build makes the bytes the Worker serves", async () => {
  for (const vendor of VENDORS) {
    // oxlint-disable-next-line no-await-in-loop -- one Vite build at a time
    const code = await compileVendor(vendor);
    assert.equal(
      code,
      served(vendorRoute(vendor)),
      `${vendorRoute(vendor)} is stale: run \`pnpm -F maker build:vendor\`, which says so if it's frozen`
    );
  }
});

test("a frozen vendor file refuses different bytes", () => {
  const [{ route }] = FROZEN;
  assert.throws(() => assertFrozen(`${served(route)};`, route), /is frozen/u);
  assert.throws(
    () => assertFrozen("", "/vendor/react-0.0.0.js"),
    /is new: add/u
  );
});

// Each package@version the Dockerfile's npm installs name, as whole tokens.
const boxInstalls = () =>
  new Map(
    readFileSync(
      path.join(import.meta.dirname, "..", "image", "Dockerfile"),
      "utf-8"
    )
      .split(/\s+/u)
      .flatMap((token) => {
        const match =
          /^(?<pkg>@?[\w.-]+(?:\/[\w.-]+)?)@(?<pinned>\d[\w.-]*)$/u.exec(token);
        return match?.groups
          ? [[match.groups.pkg, match.groups.pinned] as const]
          : [];
      })
  );

test("the box installs the versions the vendor files and the Vite build come from, and their types", () => {
  const installed = boxInstalls();
  for (const pkg of [
    ...VENDORS.map((vendor) => vendor.pkg),
    "vite",
    "@vitejs/plugin-react",
  ]) {
    assert.equal(
      installed.get(pkg),
      version(pkg),
      `the Dockerfile installs ${pkg}@${version(pkg)}`
    );
  }
  // DefinitelyTyped versions a library's types by its major.minor.
  for (const [types, lib] of [
    ["@types/react", "react"],
    ["@types/react-dom", "react-dom"],
    ["@types/three", "three"],
  ]) {
    const minor = version(lib).replace(/\.\d+$/u, "");
    assert.equal(
      installed.get(types)?.replace(/\.\d+$/u, ""),
      minor,
      `the Dockerfile installs ${types}@${minor}.x for ${lib}@${version(lib)}`
    );
  }
});

test("the vendor build makes the frozen bytes whatever NODE_ENV the shell sets", async () => {
  const [react] = VENDORS;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { compileVendor, VENDORS } from ${JSON.stringify(path.join(import.meta.dirname, "..", "vendor", "build.ts"))};
process.stdout.write(await compileVendor(VENDORS[0]));`,
    ],
    { env: { ...process.env, NODE_ENV: "production" } }
  );
  const [code, [exit]] = await Promise.all([
    text(child.stdout),
    once(child, "close") as Promise<[number]>,
  ]);
  assert.equal(exit, 0);
  assertFrozen(code, vendorRoute(react));
});
