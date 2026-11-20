import assert from "node:assert/strict";
import { test } from "node:test";

import { source } from "./judge.ts";

test("the judge reads a game's code, a Vite game's .tsx and .jsx included, and not its music or notes", () => {
  const read = source("Built", {
    "design.md": "# Moon Dash",
    "index.html": "<title>Moon Dash</title>",
    "music.mjs": "// a track",
    "src/App.jsx": "export const App = () => null;",
    "src/main.tsx": "createRoot(root).render(<App />);",
    "src/rules.ts": "export const speed = 2;",
    "src/style.css": "body { margin: 0; }",
    "tests.json": '{"expose": [], "tests": []}',
  });
  for (const file of [
    "index.html",
    "src/App.jsx",
    "src/main.tsx",
    "src/rules.ts",
    "src/style.css",
  ]) {
    assert.ok(read.includes(`Built ${file}:\n`), file);
  }
  for (const file of ["design.md", "music.mjs", "tests.json"]) {
    assert.ok(!read.includes(file), file);
  }
});

test("a game.ts comes first", () => {
  const read = source("Original", {
    "a.ts": "export const a = 1;",
    "game.ts": "function gameUpdate() {}",
  });
  assert.ok(read.startsWith("Original game.ts:\n"));
});
