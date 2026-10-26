import assert from "node:assert/strict";
import { test } from "node:test";

import { unstable_readConfig } from "wrangler";

// Bindings, vars, secrets and containers aren't inherited by a wrangler env or by Previews, so env.staging and the
// previews block repeat them by hand. One added only at the top would reach production without ever running on staging
// or in a Preview.
const config = (env) =>
  unstable_readConfig(
    { config: new URL("../wrangler.jsonc", import.meta.url).pathname, env },
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
  secrets: c.secrets?.required,
  vars: Object.keys(c.vars).toSorted(),
});

test("staging binds everything production does, to its own D1, R2 and E2B template", () => {
  const production = config();
  const staging = config("staging");
  assert.equal(staging.name, "hopon-staging");
  assert.deepEqual(shape(staging), shape(production));
  assert.notEqual(
    staging.d1_databases[0].database_name,
    production.d1_databases[0].database_name
  );
  assert.notEqual(
    staging.r2_buckets[0].bucket_name,
    production.r2_buckets[0].bucket_name
  );
  assert.notEqual(
    staging.vars.MAKER_E2B_TEMPLATE,
    production.vars.MAKER_E2B_TEMPLATE
  );
});

test("Previews bind everything production does, to staging's D1 and R2 and their own E2B template", () => {
  const production = config();
  const staging = config("staging");
  const { previews } = production;
  // previews.secrets isn't accepted (wrangler 4.152), so Previews' secrets are the base config's, set by hand (README).
  assert.deepEqual(
    shape({ ...previews, secrets: production.secrets }),
    shape(production)
  );
  assert.equal(
    previews.d1_databases[0].database_name,
    staging.d1_databases[0].database_name
  );
  assert.deepEqual(previews.r2_buckets, staging.r2_buckets);
  assert.equal(previews.vars.MAKER_E2B_TEMPLATE, "hopon-maker-preview");
});
