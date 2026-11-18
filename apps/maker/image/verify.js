// `node /opt/hopon/verify.js new|change` in the workspace: is everything a published game needs here? The agent runs it
// before `build`, and `build` runs it again with the build's kind. Prints {ok, failures} and exits 1 when something is
// missing. A new game needs music; a change keeps whatever music the game has, none included.
//
// `Music: none` passes only with a quote from one of the Creator's own messages, which the Worker writes to
// .hopon/asked.json (a JSON array) before each run: the model alone can't decide a game goes without music. The quote is
// a whole message, or whole words of one message, at least QUOTE_WORDS words or QUOTE_MIN characters, so a stray "no"
// or "music" doesn't pass.
import { existsSync, readFileSync } from "node:fs";

const QUOTE_MIN = 12;
const QUOTE_WORDS = 3;
const KINDS = new Set(["new", "change"]);

const read = (file) => (existsSync(file) ? readFileSync(file, "utf-8") : null);
// What a quote and a message are compared by: their words, in lower case, whatever the punctuation.
const words = (text) =>
  text
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
// The phone's curly quotes as straight ones.
const straight = (text) =>
  text.replaceAll(/[“”]/gu, '"').replaceAll(/[‘’]/gu, "'");
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
const asked = () => {
  try {
    const messages = JSON.parse(read(".hopon/asked.json") ?? "[]");
    return Array.isArray(messages) ? messages.map(String) : [];
  } catch {
    return [];
  }
};
// Whether one of the Creator's messages says `quote`.
const said = (quote) => {
  const wanted = words(quote);
  return asked().some((message) => {
    const heard = words(message);
    return (
      wanted === heard ||
      ((wanted.length >= QUOTE_MIN ||
        wanted.split(" ").length >= QUOTE_WORDS) &&
        ` ${heard} `.includes(` ${wanted} `))
    );
  });
};

const failures = [];

const [kind] = process.argv.slice(2);
if (!KINDS.has(kind)) {
  failures.push(
    "Run it as `node /opt/hopon/verify.js new` for a new game, or `node /opt/hopon/verify.js change` for a change to the current game."
  );
}

const design = straight(read("design.md") ?? "");
if (!design.trim()) {
  failures.push("design.md is missing: write the game's design first.");
} else if (part(design, "done[ -]when") === null) {
  failures.push('design.md has no "Done when:" criteria.');
}

const music = part(design, "music");
const noMusic = music !== null && /^none\b/iu.test(music);
if (noMusic) {
  const quote = /"(?<quote>[^"]+)"/u.exec(music)?.groups?.quote;
  if (!quote) {
    failures.push(
      'design.md says "Music: none" without the Creator\'s words: quote the message that asks for no music, as Music: none ("no music please"). If the Creator never asked, the game needs music.'
    );
  } else if (!said(quote)) {
    failures.push(
      `design.md quotes "${quote}" for "Music: none", but none of the Creator's messages says that. Quote their whole message, or at least ${QUOTE_WORDS} words of it, word for word. If the Creator never asked for no music, the game needs music.`
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
} else if (scores.length === 0 && kind === "new" && !noMusic) {
  failures.push(
    'No music: write music.mjs (music-synth skill) or music.py (music-sf2 skill). Only when the Creator asked for no music, write Music: none ("their words") in design.md instead.'
  );
}

console.log(JSON.stringify({ failures, ok: failures.length === 0 }));
process.exitCode = failures.length === 0 ? 0 : 1;
