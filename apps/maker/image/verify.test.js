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
  "music.mjs": "// a score\n",
  "tests.json": '{"expose": [], "tests": []}',
  "vite.config.ts": "export default {};\n",
};

// verify.js's verdict on a workspace of `files`, for a build of `kind`, with the Creator's messages in
// .hopon/asked.json.
const verify = (
  files,
  asked = ["make me a game"],
  kind = "new",
  flags = []
) => {
  const dir = mkdtempSync(path.join(tmpdir(), "verify-"));
  mkdirSync(path.join(dir, ".hopon"));
  writeFileSync(path.join(dir, ".hopon", "asked.json"), JSON.stringify(asked));
  for (const [file, text] of Object.entries(files)) {
    if (text !== undefined) {
      writeFileSync(path.join(dir, file), text);
    }
  }
  try {
    return JSON.parse(
      execFileSync(
        process.execPath,
        [VERIFY, ...(kind ? [kind] : []), ...flags],
        {
          cwd: dir,
        }
      )
    );
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

test("an old LittleJS or plain-DOM game fails until it is ported to a Vite project, and so does no game", () => {
  const old = {
    ...READY,
    "game.ts": "let speed = 1;\n",
    "vite.config.ts": undefined,
  };
  const port =
    "This is an old LittleJS or plain-DOM game (a game.ts and no vite.config.ts), which hopon no longer builds: port it to a Vite project first, as make-game's references/old-game.md says.";
  assert.deepEqual(verify(old, undefined, "change"), {
    failures: [port],
    ok: false,
  });
  assert.deepEqual(verify({ ...old, "index.html": "<!doctype html>" }), {
    failures: [port],
    ok: false,
  });
  assert.deepEqual(verify({ ...READY, "vite.config.ts": undefined }), {
    failures: [
      "vite.config.ts is missing: a game is a Vite project, as make-game says.",
    ],
    ok: false,
  });
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
    verify(noMusic('- **Music:** none ("no music please")'), ["a frog game"])
      .failures[0],
    /none of the Creator's messages says that/u
  );
});

test("Music: none passes with the Creator's own words, in any case and spacing", () => {
  assert.deepEqual(
    verify(noMusic("**Music**: none (“sin música por favor”)"), [
      "Haz un juego de ranas, SIN   música por favor",
    ]),
    { failures: [], ok: true }
  );
  assert.deepEqual(
    verify(noMusic('## Music\nNone ("keep it silent")'), [
      "A frog game.\nKeep it silent, I play on the bus.",
    ]),
    { failures: [], ok: true }
  );
});

test("Music: none passes under a Music heading that names it again", () => {
  assert.deepEqual(
    verify(noMusic('## Music\n\nMusic: none ("no music please")'), [
      "no music please, it's annoying",
    ]),
    { failures: [], ok: true }
  );
});

test("Music: none passes with the phone's curly quotes on either side", () => {
  assert.deepEqual(
    verify(noMusic("- **Music:** none (“don’t add any music”)"), [
      "A frog game. Don’t add any music, I’m on the bus.",
    ]),
    { failures: [], ok: true }
  );
  assert.deepEqual(
    verify(noMusic('- **Music:** none ("don\'t add any music")'), [
      "A frog game. Don’t add any music.",
    ]),
    { failures: [], ok: true }
  );
});

test("Music: none fails on a scrap of a message or words across two", () => {
  const asked = ["A frog game with no music please", "make it green"];
  for (const quote of [
    "music",
    "no",
    "no music",
    "frog ga",
    "please make it",
    "og game with no music",
    "game with no music plea",
  ]) {
    assert.match(
      verify(noMusic(`- **Music:** none ("${quote}")`), asked).failures[0],
      /none of the Creator's messages says that/u,
      quote
    );
  }
  assert.deepEqual(
    verify(noMusic('- **Music:** none ("No music.")'), ["no music"]),
    { failures: [], ok: true }
  );
});

test("a change keeps the game's music as it is, none included", () => {
  const silent = { ...READY, "music.mjs": undefined };
  assert.deepEqual(verify(silent, ["make it faster"], "change"), {
    failures: [],
    ok: true,
  });
  assert.match(
    verify(silent, ["make it faster"], "new").failures.join("\n"),
    /No music/u
  );
  assert.deepEqual(
    verify(noMusic("- **Music:** none"), ["make it faster"], "change"),
    { failures: [], ok: true }
  );
});

test("verify needs to know whether the build is new or a change", () => {
  assert.match(verify(READY, undefined, null).failures[0], /verify\.js new/u);
});

test("a change to a game that had music keeps it, unless the Creator asked to drop it", () => {
  const silent = { ...READY, "music.mjs": undefined };
  assert.match(
    verify(silent, ["make it faster"], "change", ["--had-music"]).failures.join(
      "\n"
    ),
    /No music/u
  );
  assert.deepEqual(
    verify(READY, ["make it faster"], "change", ["--had-music"]),
    {
      failures: [],
      ok: true,
    }
  );
  assert.match(
    verify(
      noMusic('- **Music:** none ("no music please")'),
      ["make it faster"],
      "change",
      ["--had-music"]
    ).failures[0],
    /none of the Creator's messages says that/u
  );
  assert.deepEqual(
    verify(
      noMusic('- **Music:** none ("drop the music please")'),
      ["make it faster", "Drop the music, please."],
      "change",
      ["--had-music"]
    ),
    { failures: [], ok: true }
  );
});
