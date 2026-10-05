import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapTarget } from '../lib/feed-motion.js';
test('feed gestures settle, advance one game, and stop at the ends', () => {
  assert.equal(snapTarget(800, 830, 800, 4), 800);
  assert.equal(snapTarget(800, 950, 800, 4), 1600);
  assert.equal(snapTarget(800, 650, 800, 4), 0);
  assert.equal(snapTarget(0, -150, 800, 4), 0);
  assert.equal(snapTarget(2400, 2700, 800, 4), 2400);
  assert.equal(snapTarget(0, 1900, 800, 4), 800);
});
