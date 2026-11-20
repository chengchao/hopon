import assert from "node:assert/strict";
import { test } from "node:test";

import { processTalk, scoresPass } from "./talker.ts";

const score = (n: number) => ({ score: n });
const built = [{ builds: [{}] }];

test("a one-agent build passes on understood alone; a two-agent one needs a good spec too", () => {
  const judged = [{ spec: score(2), understood: score(5) }];
  assert.equal(scoresPass(1, judged, built), true);
  assert.equal(scoresPass(2, judged, built), false);
  assert.equal(
    scoresPass(2, [{ spec: score(4), understood: score(5) }], built),
    true
  );
});

test("a turn not understood fails either way", () => {
  const judged = [{ spec: score(5), understood: score(3) }];
  assert.equal(scoresPass(1, judged, built), false);
  assert.equal(scoresPass(2, judged, built), false);
  assert.equal(scoresPass(1, undefined, built), false);
});

test("a reply about the advisor, tests or playtests is process talk; one about the game is not", () => {
  assert.deepEqual(
    processTalk(
      "I made Penguin Slide. Tap anywhere to jump over the rocks.\n\nI didn't ask the advisor for a final check before publishing. The tests passed, but the jump-and-score loop is untested."
    ),
    ["advisor", "final check", "the tests", "untested"]
  );
  assert.deepEqual(
    processTalk("I playtested it and verified that the score goes up."),
    ["playtested", "verified"]
  );
  for (const reply of [
    "Here's Reflex Test: tap the green dots fast to test your reflexes!",
    "I made Tower Builder. Tap to drop a block and build the tallest tower you can.",
    "Gear Up: collect tools to fix the ship before the storm hits, and dodge the bugs.",
    "Your penguin now wears a red scarf. Everything else plays the same.",
    "Hice Lluvia de Frutas: mueve la cesta para atrapar la fruta.",
  ]) {
    assert.deepEqual(processTalk(reply), [], reply);
  }
});
