import assert from "node:assert/strict";
import { test } from "node:test";

import { domHtml } from "./page.ts";

const v1 = `<body><p>hi</p><script src="/dom/v1.js"></script>
<script src="game.js"></script></body>`;

test("a plain-DOM page moves to the current scaffold and loads its music right after it", () => {
  assert.equal(
    domHtml(v1, true),
    `<body><p>hi</p><script src="/dom/v3.js"></script><script src="music.js"></script>
<script src="game.js"></script></body>`
  );
});

test("a plain-DOM page without music loses the music's script, and adding it twice keeps one", () => {
  const twice = domHtml(domHtml(v1, true), true);
  assert.equal(twice.match(/music\.js/gu)?.length, 1);
  assert.doesNotMatch(domHtml(twice, false), /music\.js/u);
});
