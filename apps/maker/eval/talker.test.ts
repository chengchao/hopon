import assert from "node:assert/strict";
import { test } from "node:test";

import { scoresPass } from "./talker.ts";

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
