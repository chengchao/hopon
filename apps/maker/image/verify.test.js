import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const VERIFY = new URL("verify.js", import.meta.url).pathname;
const DESIGN = `# Moon Cat

- **Goal:** jump from moon to moon.
- **Music:** chiptune, upbeat, 140 bpm.
- **Done when:**
  - Tapping makes the cat jump.
`;
const READY = {
  "design.md": DESIGN,
  "game.ts": "let speed = 1;\n",
  "music.mjs": "// a score\n",
  "tests.json": '{"expose": [], "tests": []}',
};

// verify.js's verdict on a workspace of `files`, with the Creator's messages in .hopon/asked.txt.
const verify = (files, asked = "make me a game") => {
  const dir = mkdtempSync(path.join(tmpdir(), "verify-"));
  mkdirSync(path.join(dir, ".hopon"));
  writeFileSync(path.join(dir, ".hopon", "asked.txt"), asked);
  for (const [file, text] of Object.entries(files)) {
    if (text !== undefined) {
      writeFileSync(path.join(dir, file), text);
    }
  }
  try {
    return JSON.parse(execFileSync(process.execPath, [VERIFY], { cwd: dir }));
  } catch (error) {
    assert.equal(error.status, 1);
    return JSON.parse(String(error.stdout));
  }
};

const noMusic = (line) => ({
  ...READY,
  "design.md": DESIGN.replace(/- \*\*Music:\*\*.*\n/u, `${line}\n`),
  "music.mjs": undefined,
});

test("a complete workspace passes", () => {
  assert.deepEqual(verify(READY), { failures: [], ok: true });
});

test("a missing design fails", () => {
  const { failures, ok } = verify({ ...READY, "design.md": undefined });
  assert.equal(ok, false);
  assert.match(failures.join("\n"), /design\.md is missing/u);
});

test("a design with no Done-when criteria fails", () => {
  const { failures } = verify({
    ...READY,
    "design.md": DESIGN.replace(/- \*\*Done when[^]*$/u, ""),
  });
  assert.match(failures.join("\n"), /no "Done when:" criteria/u);
});

test("a game with no music and no Music: none fails", () => {
  const { failures } = verify({ ...READY, "music.mjs": undefined });
  assert.match(failures.join("\n"), /No music: write music\.mjs/u);
});

test("Music: none fails when no message of the Creator's asks for it", () => {
  assert.match(
    verify(noMusic("- **Music:** none")).failures.join("\n"),
    /without the Creator's words/u
  );
  assert.match(
    verify(noMusic('- **Music:** none ("no music please")'), "a frog game")
      .failures[0],
    /none of the Creator's messages says that/u
  );
});

test("Music: none passes with the Creator's own words, in any case and spacing", () => {
  assert.deepEqual(
    verify(
      noMusic("**Music**: none (“sin música”)"),
      "Haz un juego de ranas, SIN   música por favor"
    ),
    { failures: [], ok: true }
  );
  assert.deepEqual(
    verify(
      noMusic('## Music\nNone ("keep it silent")'),
      "A frog game.\nKeep it silent, I play on the bus."
    ),
    { failures: [], ok: true }
  );
});
