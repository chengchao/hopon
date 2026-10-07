import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";

// drizzle-kit rebuilds a table with `INSERT INTO `__new_t`(…) SELECT "a", "b" FROM `t``, and lists every column of the new
// table in the SELECT, even ones the old table lacks. SQLite reads an unknown "name" as a string literal, so each copied row
// would get the column's name as its value. Hand-fix such a column to NULL (or its default) in the generated SQL.
export const copiedColumns = (sql) =>
  [
    ...sql.matchAll(
      /INSERT INTO `__new_(?<table>\w+)`\([^)]*\) SELECT (?<columns>.*?) FROM `\k<table>`/gu
    ),
  ].map(({ groups: { table, columns } }) => ({
    columns: [...columns.matchAll(/"(?<name>\w+)"/gu)].map(
      (match) => match.groups.name
    ),
    table,
  }));

test("table rebuilds copy only columns the old table has", async (t) => {
  const proxy = await getPlatformProxy({
    envFiles: [],
    persist: false,
    remoteBindings: false,
  });
  t.after(() => proxy.dispose());
  const { DB } = proxy.env;
  const dir = new URL("../migrations/", import.meta.url);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .toSorted();
  for (const file of files) {
    const sql = readFileSync(new URL(file, dir), "utf-8");
    for (const { table, columns } of copiedColumns(sql)) {
      // oxlint-disable-next-line no-await-in-loop -- each migration sees the tables the ones before it left
      const { results } = await DB.prepare(
        `SELECT name FROM pragma_table_info('${table}')`
      ).all();
      const old = new Set(results.map((r) => r.name));
      assert.deepEqual(
        columns.filter((c) => !old.has(c)),
        [],
        `${file} copies columns ${table} doesn't have yet`
      );
    }
    // oxlint-disable-next-line no-await-in-loop -- migrations apply in order
    await DB.batch(unstable_splitSqlQuery(sql).map((s) => DB.prepare(s)));
  }
});

test("the check reads the rebuild that would have copied 'body' into every report", () => {
  assert.deepEqual(
    copiedColumns(
      'INSERT INTO `__new_reports`("body", "comment_id", "id") SELECT "body", "comment_id", "id" FROM `reports`;'
    ),
    [{ columns: ["body", "comment_id", "id"], table: "reports" }]
  );
  assert.deepEqual(
    copiedColumns(
      'INSERT INTO `__new_reports`("body", "id") SELECT NULL, "id" FROM `reports`;'
    ),
    [{ columns: ["id"], table: "reports" }]
  );
});
