import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { unstable_readConfig } from "wrangler";

// Bindings and vars aren't inherited by Previews, so the previews block repeats them by hand. One added only at the top
// would reach production without ever running in a Preview.
const config = (file) =>
  unstable_readConfig(
    { config: new URL(`../${file}`, import.meta.url).pathname },
    { hideWarnings: true }
  );
const shape = (c) => ({
  ai: c.ai?.binding,
  d1: c.d1_databases.map((x) => [x.binding, x.migrations_dir]),
  durableObjects: c.durable_objects.bindings,
  r2: c.r2_buckets.map((x) => x.binding),
  vars: Object.keys(c.vars).toSorted(),
});

test("Previews bind everything production does, to their own D1 and R2", () => {
  const production = config("wrangler.jsonc");
  const { previews } = production;
  assert.deepEqual(shape(previews), shape(production));
  assert.notEqual(
    previews.d1_databases[0].database_id,
    production.d1_databases[0].database_id
  );
  assert.notEqual(
    previews.r2_buckets[0].bucket_name,
    production.r2_buckets[0].bucket_name
  );
});

test("deploy:preview migrates the D1 the Previews bind", () => {
  const [previewDb] = config("wrangler.jsonc").previews.d1_databases;
  const [migrated] = config("wrangler.preview-migrations.jsonc").d1_databases;
  for (const key of ["database_id", "database_name", "migrations_dir"]) {
    assert.equal(migrated[key], previewDb[key], key);
  }
});

// The Coder's box (#175) is a durable_object-policy container, which wrangler takes only at the top level, and
// `wrangler preview` deploys none from there: a Preview's Coder has no box. Once wrangler takes one under `previews`,
// repeat production's there and compare the two here.
test("production's Coder has its box; a Preview's can't yet", () => {
  const production = config("wrangler.jsonc");
  assert.deepEqual(production.containers, [
    {
      class_name: "DraftCoder",
      images: {
        box: {
          build_context: "../maker/image",
          dockerfile: "../maker/image/Dockerfile",
        },
      },
      name: "hopon-draftcoder",
      scheduling_policy: "durable_object",
    },
  ]);
  assert.equal(production.previews.containers, undefined);
});

// Files (@cloudflare/sandbox) runs the box's sandbox-shim, copied from cloudflare/sandbox's image of the same version.
test("the box's sandbox-shim is @cloudflare/sandbox's version", () => {
  const dockerfile = readFileSync(
    new URL("../../maker/image/Dockerfile", import.meta.url),
    "utf-8"
  );
  const { dependencies } = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf-8")
  );
  const [, tag] =
    /--from=docker\.io\/cloudflare\/sandbox:(?<tag>\S+) /u.exec(dockerfile) ??
    [];
  assert.equal(tag, dependencies["@cloudflare/sandbox"]);
});
