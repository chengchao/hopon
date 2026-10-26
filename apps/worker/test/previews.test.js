import assert from "node:assert/strict";
import { test } from "node:test";

import { unstable_readConfig } from "wrangler";

// Bindings, vars and containers aren't inherited by Previews, so the previews block repeats them by hand. One added only
// at the top would reach production without ever running in a Preview.
const config = (file) =>
  unstable_readConfig(
    { config: new URL(`../${file}`, import.meta.url).pathname },
    { hideWarnings: true }
  );
const shape = (c) => ({
  ai: c.ai?.binding,
  containers: c.containers.map((x) => [
    x.class_name,
    x.instance_type,
    x.rollout_active_grace_period,
  ]),
  d1: c.d1_databases.map((x) => [x.binding, x.migrations_dir]),
  durableObjects: c.durable_objects.bindings,
  r2: c.r2_buckets.map((x) => x.binding),
  vars: Object.keys(c.vars).toSorted(),
});

test("Previews bind everything production does, to their own D1, R2 and E2B template", () => {
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
  assert.notEqual(
    previews.vars.MAKER_E2B_TEMPLATE,
    production.vars.MAKER_E2B_TEMPLATE
  );
});

test("deploy:preview migrates the D1 the Previews bind", () => {
  const [previewDb] = config("wrangler.jsonc").previews.d1_databases;
  const [migrated] = config("wrangler.preview-migrations.jsonc").d1_databases;
  for (const key of ["database_id", "database_name", "migrations_dir"]) {
    assert.equal(migrated[key], previewDb[key], key);
  }
});
