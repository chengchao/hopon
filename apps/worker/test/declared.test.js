import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

// ponytail: regexes over the source, like sql-subqueries.test.js; parse with oxc if they ever misread it.
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf-8");
const src = new URL("../src/", import.meta.url);
const source = readdirSync(src)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => readFileSync(new URL(f, src), "utf-8"))
  .join("\n");

// With a `secrets` block in wrangler.jsonc, `wrangler dev` loads only the secrets listed in `secrets.required` and
// silently drops the rest of .dev.vars. Tests build `env` by hand, so only this check sees an undeclared one.
test("every env value the Worker reads is declared in wrangler.jsonc", () => {
  const declared = new Set([
    ...[
      ...read("../worker-configuration.d.ts")
        .match(/interface __BaseEnv_Env \{(?<body>[^}]*)\}/u)
        .groups.body.matchAll(/^\s*(?<name>\w+):/gmu),
    ].map((m) => m.groups.name),
    // Set with `--var` by `pnpm api:offline` and `pnpm -F worker dev:coder`, not by wrangler.jsonc.
    "HOPON_OFFLINE",
    "CODER_DEV",
  ]);
  const used = new Set(
    [...source.matchAll(/\benv\.(?<name>[A-Z][A-Z0-9_]*)\b/gu)].map(
      (m) => m.groups.name
    )
  );
  assert.deepEqual(
    [...used].filter((name) => !declared.has(name)),
    [],
    "add it to wrangler.jsonc (a secret goes in secrets.required), then run `pnpm -F worker types`"
  );
});

// No FK cascade (see schema.ts), so a game's rows in other tables go only where `deleteGames` deletes them.
test("deleteGames deletes every table that points at games", () => {
  const children = read("../src/schema.ts")
    .split(/^export const /mu)
    .filter((table) => table.includes("references(() => games.id)"))
    .map((table) => table.match(/^\w+/u)[0]);
  const [body] = source.match(/const deleteGames = [\s\S]*?\n\};/u);
  const deleted = new Set(
    [...body.matchAll(/\.delete\((?<table>\w+)\)/gu)].map((m) => m.groups.table)
  );
  assert.ok(children.length > 0);
  assert.deepEqual(
    children.filter((table) => !deleted.has(table)),
    [],
    "delete it in deleteGames (apps/worker/src/api.ts)"
  );
});

// wrangler only warns about a missing secret, so a new one nobody has set locally fails much later, far from its cause.
test("every secret the Worker requires has a setup step in the README", () => {
  const required = read("../wrangler.jsonc")
    .match(/"required":\s*\[(?<body>[^\]]*)\]/u)
    .groups.body.matchAll(/"(?<name>[A-Z][A-Z0-9_]*)"/gu);
  const readme = read("../../../README.md");
  assert.deepEqual(
    [...required]
      .map((m) => m.groups.name)
      .filter((name) => !readme.includes(name)),
    [],
    "add a step for it to README.md's setup (where its value comes from, and the .dev.vars line)"
  );
});
