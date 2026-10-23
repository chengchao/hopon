import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

// Drizzle renders `${table.column}` without its table name in a one-table select, so inside a raw subquery
// `${comments.gameId} = ${games.id}` becomes `"game_id" = "id"`, and "id" binds to the inner table.
// Subqueries name tables by hand instead: `${comments}.game_id = ${games}.id`.
// ponytail: a regex over the source, so a template holding a nested backtick isn't read; parse with oxc if one appears.
export const bareColumnsInSubqueries = (source) =>
  [...source.matchAll(/\bsql(?:<[^>`]*>)?`(?<body>[^`]*)`/gu)]
    .filter(
      ({ groups: { body } }) =>
        /\bselect\b/iu.test(body) && /\$\{\s*\w+\.\w+\s*\}/u.test(body)
    )
    .map(([template]) => template);

test("raw sql subqueries qualify their columns", () => {
  const src = new URL("../src/", import.meta.url);
  for (const file of readdirSync(src).filter((f) => f.endsWith(".ts"))) {
    assert.deepEqual(
      bareColumnsInSubqueries(readFileSync(new URL(file, src), "utf-8")),
      [],
      file
    );
  }
});

test("the check flags the bare-column subquery that miscounted comments", () => {
  assert.equal(
    bareColumnsInSubqueries(
      // oxlint-disable-next-line no-template-curly-in-string -- the fixture is Drizzle source text, `${` included
      "sql<number>`(SELECT COUNT(*) FROM ${comments} WHERE ${comments.gameId} = ${games.id})`"
    ).length,
    1
  );
  assert.equal(
    bareColumnsInSubqueries(
      // oxlint-disable-next-line no-template-curly-in-string -- the fixture is Drizzle source text, `${` included
      "sql`(SELECT COUNT(*) FROM ${comments} WHERE ${comments}.game_id = ${games}.id)`"
    ).length,
    0
  );
  // Plain expressions outside a subquery render fine.
  assert.equal(
    // oxlint-disable-next-line no-template-curly-in-string -- the fixture is Drizzle source text, `${` included
    bareColumnsInSubqueries("sql`length(${table.title}) BETWEEN 1 AND 60`")
      .length,
    0
  );
});
