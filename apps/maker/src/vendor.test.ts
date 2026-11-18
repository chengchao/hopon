import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  assertFrozen,
  compileVendor,
  FROZEN,
  servedPath,
  VENDOR_DIR,
  VENDORS,
  vendorRoute,
  version,
} from "../vendor/build.ts";

const served = (route: string): string =>
  JSON.parse(readFileSync(servedPath(route), "utf-8"));

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

test("the box installs the versions the vendor files are built from", () => {
  const dockerfile = readFileSync(
    path.join(import.meta.dirname, "..", "image", "Dockerfile"),
    "utf-8"
  );
  for (const { pkg } of VENDORS) {
    assert.ok(
      dockerfile.includes(` ${pkg}@${version(pkg)} `),
      `the Dockerfile installs ${pkg}@${version(pkg)}`
    );
  }
});
