import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import { getPlatformProxy, unstable_splitSqlQuery } from "wrangler";

import { copyGames } from "../scripts/games-to-r2.mjs";
import worker from "../src/api.ts";
import { GAME_CSP } from "../src/game.ts";

const migrationsDir = new URL("../migrations/", import.meta.url);
const statements = (file) =>
  unstable_splitSqlQuery(readFileSync(new URL(file, migrationsDir), "utf-8"));

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
    configPath: new URL("wrangler.jsonc", import.meta.url).pathname,
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

test("games are files: published Games' HTML lands in R2 and still plays; unpublished rows are gone", async (t) => {
  const proxy = await getPlatformProxy({
    configPath: new URL("wrangler.jsonc", import.meta.url).pathname,
    envFiles: [],
    persist: false,
    remoteBindings: false,
  });
  t.after(() => proxy.dispose());
  const { DB, FILES } = proxy.env;
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .toSorted();
  const at = files.findIndex((f) => f.endsWith("_games_are_files.sql"));
  const run = (sql) => DB.batch(sql.map((s) => DB.prepare(s)));
  await run(files.slice(0, at).flatMap(statements));
  // D1 as it was: the originals, a Creator's published game that people like, comment on and save, and a draft.
  await run([
    "INSERT INTO games(id, owner, title, description, html, published, author) VALUES (100, 'user_a', 'Made', 'Tap', '<!doctype html><html><body>made</body></html>', 1, 'maya')",
    "INSERT INTO games(id, owner, title, description, html, published) VALUES (101, 'user_a', 'Draft', '', '<html></html>', 0)",
    "INSERT INTO likes(game_id, user) VALUES (100, 'user_b')",
    "INSERT INTO comments(game_id, user, author, body) VALUES (100, 'user_b', 'b', 'nice')",
    "INSERT INTO saves(game_id, user) VALUES (100, 'user_b')",
  ]);
  const { results: before } = await DB.prepare(
    "SELECT id, html FROM games WHERE published = 1 ORDER BY id"
  ).all();
  assert.equal(before.at(-1).id, 100);

  // scripts/games-to-r2.mjs first, then the migration.
  const copied = await copyGames(DB, FILES);
  assert.deepEqual(
    copied.toSorted((a, b) => a - b),
    before.map((g) => g.id)
  );
  await run(files.slice(at).flatMap(statements));

  const { results: after } = await DB.prepare(
    "SELECT author, draft_id, id, runtime, title FROM games ORDER BY id"
  ).all();
  assert.deepEqual(
    after.map((g) => g.id),
    before.map((g) => g.id)
  );
  // Bubble Pop loads the runtime; the other originals and the Creator's game are plain DOM.
  assert.deepEqual(
    after.map((g) => g.runtime),
    before.map((g) => (g.html.includes("/runtime/v1.js") ? "v2" : null))
  );
  assert.ok(after.some((g) => g.runtime === "v2"));
  assert.deepEqual(
    { ...after.at(-1) },
    { author: "maya", draft_id: null, id: 100, runtime: null, title: "Made" }
  );
  // The draft's id 101 isn't given again: the next Game is 102.
  const { id: next } = await DB.prepare(
    "INSERT INTO games(owner, title, description) VALUES ('user_a', 'Next', '') RETURNING id"
  ).first();
  assert.equal(next, 102);
  for (const table of ["likes", "comments", "saves"]) {
    // oxlint-disable-next-line no-await-in-loop -- three counts
    const { n } = await DB.prepare(
      `SELECT COUNT(*) AS n FROM ${table}`
    ).first();
    assert.equal(n, 1, table);
  }
  await assert.rejects(
    DB.prepare("INSERT INTO likes(game_id, user) VALUES (101, 'x')").run(),
    /FOREIGN KEY/u
  );
  // Every Game plays from its files, exactly as its HTML was, but on the runtime's v2.
  for (const game of before) {
    // oxlint-disable-next-line no-await-in-loop -- one game at a time
    const page = await worker.fetch(
      new Request(`https://hopon.test/games/${game.id}/index.html`),
      { DB, FILES },
      { passThroughOnException: () => {}, waitUntil: () => {} }
    );
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("Content-Security-Policy"), GAME_CSP);
    const html = game.html.replaceAll("/runtime/v1.js", "/runtime/v2.js");
    // oxlint-disable-next-line no-await-in-loop -- see above
    assert.equal(await page.text(), html);
  }
});
