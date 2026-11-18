// `node /opt/hopon/verify.js` in the workspace: is everything a published game needs here? The agent runs it before
// `build`, and `build` runs it again. Prints {ok, failures} and exits 1 when something is missing.
//
// `Music: none` passes only with a quote from the Creator's own messages, which the Worker writes to .hopon/asked.txt
// before each run: the model alone can't decide a game goes without music.
import { existsSync, readFileSync } from "node:fs";

const read = (file) => (existsSync(file) ? readFileSync(file, "utf-8") : null);
const plain = (text) => text.toLowerCase().replaceAll(/\s+/gu, " ").trim();
// design.md's lines without Markdown's heading, list and bold marks.
const lines = (text) =>
  text
    .split("\n")
    .map((line) => line.replaceAll(/^[\s#>*-]+|\*+/gu, "").trim())
    .filter(Boolean);
// A part's text: what follows "Name:" on its line, or the line after a "Name" heading.
const part = (text, name) => {
  const all = lines(text);
  const at = all.findIndex((line) =>
    new RegExp(`^${name}\\b\\s*:?`, "iu").test(line)
  );
  if (at === -1) {
    return null;
  }
  const rest = all[at].replace(new RegExp(`^${name}\\b\\s*:?\\s*`, "iu"), "");
  return rest || all[at + 1] || "";
};

const failures = [];

const design = read("design.md") ?? "";
if (!design.trim()) {
  failures.push("design.md is missing: write the game's design first.");
} else if (part(design, "done[ -]when") === null) {
  failures.push('design.md has no "Done when:" criteria.');
}

const music = part(design, "music");
const noMusic = music !== null && /^none\b/iu.test(music);
if (noMusic) {
  const quote = /["“”]([^"“”]+)["“”]/u.exec(music)?.[1];
  const asked = plain(read(".hopon/asked.txt") ?? "");
  if (!quote) {
    failures.push(
      'design.md says "Music: none" without the Creator\'s words: quote the message that asks for no music, as Music: none ("no music please"). If the Creator never asked, the game needs music.'
    );
  } else if (!asked.includes(plain(quote))) {
    failures.push(
      `design.md quotes "${quote}" for "Music: none", but none of the Creator's messages says that. If the Creator never asked for no music, the game needs music.`
    );
  }
}

const tests = read("tests.json");
if (tests === null) {
  failures.push("tests.json is missing.");
} else {
  try {
    const parsed = JSON.parse(tests);
    if (!Array.isArray(parsed.expose) || !Array.isArray(parsed.tests)) {
      failures.push('tests.json needs "expose" and "tests" arrays.');
    }
  } catch (error) {
    failures.push(`tests.json isn't valid JSON: ${error.message}`);
  }
}

if (!existsSync("game.ts")) {
  failures.push("game.ts is missing.");
}

const scores = ["music.mjs", "music.py"].filter((file) => existsSync(file));
if (scores.length > 1) {
  failures.push("music.mjs and music.py are both here: keep one.");
} else if (scores.length === 0 && !noMusic) {
  failures.push(
    'No music: write music.mjs (music-synth skill) or music.py (music-sf2 skill). Only when the Creator asked for no music, write Music: none ("their words") in design.md instead.'
  );
}

console.log(JSON.stringify({ failures, ok: failures.length === 0 }));
process.exitCode = failures.length === 0 ? 0 : 1;
