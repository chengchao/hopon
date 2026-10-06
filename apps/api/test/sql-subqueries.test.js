import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// Drizzle renders `${table.column}` without its table name in a one-table select, so inside a raw subquery
// `${comments.gameId} = ${games.id}` becomes `"game_id" = "id"`, and "id" binds to the inner table.
// Subqueries name tables by hand instead: `${comments}.game_id = ${games}.id`.
// ponytail: a regex over the source, so a template holding a nested backtick isn't read; parse with oxc if one appears.
export function bareColumnsInSubqueries(source) {
  return [...source.matchAll(/\bsql(?:<[^>`]*>)?`([^`]*)`/g)]
    .filter(([, body]) => /\bselect\b/i.test(body) && /\$\{\s*\w+\.\w+\s*\}/.test(body))
    .map(([template]) => template);
}

test('raw sql subqueries qualify their columns', () => {
  const src = new URL('../src/', import.meta.url);
  for (const file of readdirSync(src).filter((f) => f.endsWith('.ts')))
    assert.deepEqual(bareColumnsInSubqueries(readFileSync(new URL(file, src), 'utf8')), [], file);
});

test('the check flags the bare-column subquery that miscounted comments', () => {
  assert.equal(
    bareColumnsInSubqueries('sql<number>`(SELECT COUNT(*) FROM ${comments} WHERE ${comments.gameId} = ${games.id})`')
      .length,
    1,
  );
  assert.equal(
    bareColumnsInSubqueries('sql`(SELECT COUNT(*) FROM ${comments} WHERE ${comments}.game_id = ${games}.id)`').length,
    0,
  );
  // Plain expressions outside a subquery render fine.
  assert.equal(bareColumnsInSubqueries('sql`length(${table.title}) BETWEEN 1 AND 60`').length, 0);
});
