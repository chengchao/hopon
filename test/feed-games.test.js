import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedPage } from '../src/feed-games.js';
test('original microgames remain available after the first publication and only follow the final page', () => {
  const published = { id: 1, title: 'Ocean Memory', description: 'Match pairs' };
  assert.deepEqual(feedPage({ games: [], next: null }).map(g => g.id), [-1, -2]);
  assert.deepEqual(feedPage({ games: [published], next: null }).map(g => g.id), [1, -1, -2]);
  const first = feedPage({ games: [{ ...published, id: 2 }], next: 2 });
  assert.deepEqual(first.map(g => g.id), [2]);
  assert.deepEqual([...first, ...feedPage({ games: [published], next: null })].map(g => g.id), [2, 1, -1, -2]);
});
