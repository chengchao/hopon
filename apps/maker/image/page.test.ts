import assert from "node:assert/strict";
import { test } from "node:test";

import { domHtml, isLittlejsHtml, littlejsHtml, viteHtml } from "./page.ts";

const v1 = `<head></head><body><p>hi</p><script src="/dom/v1.js"></script>
<script src="game.js"></script></body>`;

test("a plain-DOM page moves to the current scaffold and loses an older Revision's music script", () => {
  const old = v1.replace(
    "</script>",
    '</script><script src="music.js"></script>'
  );
  assert.equal(domHtml(old), domHtml(v1));
  assert.equal(
    domHtml(v1),
    `<head></head><body><p>hi</p><script src="/dom/v4.js"></script>
<script src="game.js"></script></body>`
  );
});

test("a built page names its music on the scaffold's script and links its stylesheet once", () => {
  const files = { css: "game.css", music: "music.opus" };
  const page = domHtml(domHtml(v1, files), files);
  assert.match(
    page,
    /<script src="\/dom\/v4\.js" data-music="music\.opus"><\/script>/u
  );
  assert.equal(page.match(/game\.css/gu)?.length, 1);
  assert.match(page, /<link rel="stylesheet" href="game\.css"><\/head>/u);
  assert.doesNotMatch(domHtml(page), /data-music/u);
  const littlejs = littlejsHtml(files);
  assert.match(
    littlejs,
    /<script src="\/runtime\/v4\.js" data-music="music\.opus"><\/script><script src="game\.js">/u
  );
  assert.match(littlejs, /<link rel="stylesheet" href="game\.css">/u);
  assert.ok(isLittlejsHtml(littlejs));
  assert.doesNotMatch(littlejsHtml(), /data-music|stylesheet/u);
});

test("a Vite game's built page names its music on the scaffold's script exactly when it has some", () => {
  const built =
    '<head><script src="/hopon/v1.js" data-music="old.opus"></script><script type="module" crossorigin src="./index-a1.js"></script></head>';
  const page = viteHtml(built, { music: "music.opus" });
  assert.equal(
    page,
    '<head><script src="/hopon/v1.js" data-music="music.opus"></script><script type="module" crossorigin src="./index-a1.js"></script></head>'
  );
  assert.doesNotMatch(viteHtml(page), /data-music/u);
});
