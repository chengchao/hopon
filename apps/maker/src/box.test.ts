import assert from "node:assert/strict";
import { test } from "node:test";

import { LocalBox } from "./box.ts";

test("box helpers: write, patch needs exactly one match, no inherited env", async () => {
  process.env.HOPON_TEST_SECRET = "leak";
  const box = await LocalBox.create();
  await box.writeFile("game.ts", "let a = 1;\nlet b = 1;\n");

  const ok = await box.run(
    `patch("game.ts", "let a = 1", "let a = 2"); console.log(read("game.ts"));`
  );
  assert.equal(ok.exitCode, 0);
  assert.match(ok.stdout, /let a = 2/u);
  assert.deepEqual(ok.files, ["game.ts"]);

  const twice = await box.run(`patch("game.ts", "= ", "=")`);
  assert.notEqual(twice.exitCode, 0);
  assert.match(twice.stderr, /exactly one match in game.ts, found 2/u);

  const env = await box.run(
    "console.log(process.env.HOPON_TEST_SECRET ?? 'none')"
  );
  assert.equal(env.stdout.trim(), "none");
});
