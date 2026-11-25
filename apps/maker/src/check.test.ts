// The harness check (ADR 0006) on the real sandbox image, in Docker: what a model leaves behind can't pass a game that
// doesn't run, and the agent's tests decide a build. It needs the image, so it runs only
// with HOPON_BOX_IMAGE set, e.g. to one of `docker images cloudflare-dev/maker-box-*` after `pnpm -F worker dev:maker`.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buffer } from "node:stream/consumers";
import { after, before, test } from "node:test";
import { gunzipSync } from "node:zlib";

import { DOM_SRC, GAME_CSP, littlejsHtml } from "../image/page.ts";
import { FROZEN, vendorPaths } from "../vendor/build.ts";
import {
  boxPlaytest,
  checkBuild,
  packSource,
  restore,
  SOURCE_TAR,
  WORKSPACE,
} from "./job.ts";
import type { Box, Tests } from "./job.ts";

const IMAGE = process.env.HOPON_BOX_IMAGE;
const skip = IMAGE ? false : "set HOPON_BOX_IMAGE to the sandbox image";
const USER = ["-u", "1001:1001", "-e", "HOME=/home/user"];

const docker = async (args: string[], input?: string | Uint8Array) => {
  const child = spawn("docker", args);
  child.stdin.end(input);
  const [stdout, stderr, [code]] = await Promise.all([
    buffer(child.stdout),
    buffer(child.stderr),
    once(child, "close") as Promise<[number | null]>,
  ]);
  return { exitCode: code ?? 1, stderr: stderr.toString(), stdout };
};

let container = "";

// As the Worker's jobBox: the program from its argv, as the box's user, in the workspace.
const box: Box = {
  exec: async (argv) => {
    const result = await docker([
      "exec",
      ...USER,
      "-w",
      WORKSPACE,
      container,
      ...argv,
    ]);
    return { ...result, stdout: result.stdout.toString() };
  },
  read: async (file) => {
    const bytes = await box.readBytes(file);
    return bytes.toString();
  },
  readBytes: async (file) => {
    const result = await docker(["exec", container, "/usr/bin/cat", file]);
    if (result.exitCode !== 0) {
      throw new Error(`no ${file}`);
    }
    return result.stdout;
  },
  write: async (file, text) => {
    await docker([
      "exec",
      ...USER,
      container,
      "/usr/bin/mkdir",
      "-p",
      path.posix.dirname(file),
    ]);
    await docker(
      ["exec", "-i", ...USER, container, "/usr/bin/tee", file],
      text
    );
  },
};

// The box, and every file the harness read back from it.
const recording = () => {
  const read: string[] = [];
  const recorded: Box = {
    ...box,
    readBytes: (file) => {
      read.push(file);
      return box.readBytes(file);
    },
  };
  return { box: recorded, read };
};

const text = (bytes: Uint8Array | undefined) =>
  Buffer.from(bytes ?? []).toString();

// source.tgz's files, unpacked on this machine.
const unpacked = async (tar: Uint8Array | undefined) => {
  const dir = mkdtempSync(path.join(tmpdir(), "hopon-source-"));
  try {
    const child = spawn("tar", ["-xzf", "-", "-C", dir]);
    child.stdin.end(tar);
    const [code] = (await once(child, "close")) as [number];
    assert.equal(code, 0);
    return Object.fromEntries(
      readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const file = path.join(entry.parentPath, entry.name);
          return [path.relative(dir, file), readFileSync(file, "utf-8")];
        })
    );
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
};

// What a model's bash tool runs: a login shell.
const bash = (command: string) =>
  docker(["exec", ...USER, "-w", WORKSPACE, container, "bash", "-lc", command]);

const GAME = readFileSync(
  path.join(import.meta.dirname, "../eval/revisions/fruit-catcher/game.ts"),
  "utf-8"
);
const withLine = (line: string) =>
  GAME.replace("function gameUpdate() {", `function gameUpdate() {\n  ${line}`);
const BROKEN = withLine('throw new Error("broken game");');
// The agent's playtest inputs: taps in the middle.
const INPUTS = JSON.stringify({
  inputs: [500, 1000, 1500, 2000].map((at) => ({
    at,
    type: "tap",
    x: 180,
    y: 320,
  })),
  ms: 3000,
});
const noMusic = { music: false };
const files = (source: Record<string, string>) => ({ files: source });

const processes = async () => {
  const result = await box.exec([
    "/usr/local/bin/node",
    "-e",
    "const fs = require('fs'); for (const p of fs.readdirSync('/proc')) { try { console.log(fs.readFileSync('/proc/' + p + '/cmdline', 'utf-8').replaceAll('\\0', ' ')) } catch {} }",
  ]);
  return result.stdout;
};

before(async () => {
  if (!IMAGE) {
    return;
  }
  const started = await docker(["run", "-d", "--network", "none", IMAGE]);
  assert.equal(started.exitCode, 0, started.stderr);
  container = started.stdout.toString().trim();
});

after(async () => {
  if (container) {
    await docker(["rm", "-f", container]);
  }
});

test(
  "a ~/.bash_profile and a background process a model left can't pass a game that doesn't run",
  { skip, timeout: 300_000 },
  async () => {
    await restore(box, files({ "game.ts": BROKEN }));
    await bash(
      [
        `echo 'node() { echo "{\\"ok\\":true,\\"errors\\":[],\\"typeErrors\\":[]}"; }' >> ~/.bash_profile`,
        "cp game.ts /tmp/broken.ts",
      ].join(" && ")
    );
    await box.write("/tmp/good.ts", GAME);
    await docker([
      "exec",
      "-d",
      ...USER,
      container,
      "sh",
      "-c",
      "cd /workspace; while [ -e game.ts ]; do :; done; until [ -s game.ts ]; do :; done; cp /tmp/good.ts /tmp/next.ts && mv /tmp/next.ts game.ts",
    ]);
    const fooled = await bash(`node /opt/hopon/playtest.js '${INPUTS}'`);
    assert.match(
      fooled.stdout.toString(),
      /"ok":true/u,
      "the planted ~/.bash_profile fools a playtest run through a login shell"
    );

    try {
      const verdict = await checkBuild(box, noMusic);

      assert.ok("errors" in verdict, JSON.stringify(verdict));
      assert.match(
        verdict.errors.join("\n"),
        /the workspace changed while the harness ran it/u
      );
      const profile = await bash("test -e ~/.bash_profile && echo still there");
      assert.equal(
        profile.stdout.toString(),
        "",
        "the home directory was cleared"
      );
    } finally {
      await docker([
        "exec",
        container,
        "/usr/local/bin/node",
        "-e",
        "const fs = require('fs'); for (const p of fs.readdirSync('/proc')) { try { if (Number(p) !== process.pid && fs.readFileSync('/proc/' + p + '/cmdline', 'utf-8').includes('good.ts')) process.kill(Number(p), 'SIGKILL') } catch {} }",
      ]);
    }
    assert.doesNotMatch(await processes(), /good\.ts/u, "the loop is gone");
  }
);

test(
  "a game that throws when it runs fails the check, with no test from the agent",
  { skip, timeout: 300_000 },
  async () => {
    await restore(box, files({ "game.ts": BROKEN }));

    const verdict = await checkBuild(box, noMusic);

    assert.ok("errors" in verdict, JSON.stringify(verdict));
    assert.match(
      verdict.errors.join("\n"),
      /test "the game runs": console error .*broken game/u
    );
  }
);

test(
  "a playtest says where its time went",
  { skip, timeout: 300_000 },
  async () => {
    await restore(box, files({ "game.ts": GAME }));

    const result = await boxPlaytest(box, INPUTS);

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(Object.keys(result.timings ?? {}).toSorted(), [
      "browserMs",
      "emitMs",
      "loadMs",
      "playMs",
      "screenshotsMs",
      "typecheckMs",
    ]);
  }
);

const TESTED = withLine("testVars.basketX = bx;").replace(
  "function gameUpdate() {",
  "const testVars: Record<string, number> = {};\nfunction gameUpdate() {"
);
const swipeLeft = (expect: string): Tests => ({
  expose: [{ means: "the basket's x, in world units", name: "basketX" }],
  tests: [
    {
      checks: [{ at: 1000, expect }],
      inputs: [{ at: 300, dx: -120, dy: 0, type: "swipe", x: 180, y: 500 }],
      name: "a swipe left moves the basket left",
    },
  ],
});
const tested = (tests: Tests) => ({ music: false, tests });

test(
  "the agent's tests pass on a game that does what they check",
  { skip, timeout: 300_000 },
  async () => {
    await restore(box, files({ "game.ts": TESTED }));

    const verdict = await checkBuild(
      box,
      tested(swipeLeft("vars.basketX < prev.vars.basketX"))
    );

    assert.ok("files" in verdict, JSON.stringify(verdict));
  }
);

test(
  "a test the game doesn't meet fails the check, with what the game showed",
  { skip, timeout: 300_000 },
  async () => {
    await restore(box, files({ "game.ts": TESTED }));

    const verdict = await checkBuild(
      box,
      tested(swipeLeft("vars.basketX > prev.vars.basketX"))
    );

    assert.ok("errors" in verdict, JSON.stringify(verdict));
    assert.match(
      verdict.errors.join("\n"),
      /test "a swipe left moves the basket left": at 1000 ms, expected vars\.basketX > prev\.vars\.basketX; got vars \{"basketX":-?\d/u
    );
  }
);

test(
  "a check that throws is the test's error: it doesn't fail the build, and the harness reports it",
  { skip, timeout: 300_000 },
  async () => {
    await restore(box, files({ "game.ts": TESTED }));

    const verdict = await checkBuild(
      box,
      tested(swipeLeft("vars.basketX < prev.missing.basketX"))
    );

    assert.ok("files" in verdict, JSON.stringify(verdict));
    assert.match(
      (verdict.testErrors ?? []).join("\n"),
      /test "a swipe left moves the basket left": at 1000 ms, vars\.basketX < prev\.missing\.basketX threw TypeError/u
    );
  }
);

test(
  "a game that runs passes, and the Revision holds what the check played",
  { skip, timeout: 300_000 },
  async () => {
    await restore(box, files({ "game.ts": GAME }));

    const verdict = await checkBuild(box, noMusic);

    assert.ok("files" in verdict, JSON.stringify(verdict));
    assert.deepEqual(Object.keys(verdict.files).toSorted(), [
      "game.js",
      "index.html",
      SOURCE_TAR,
    ]);
    assert.deepEqual(
      verdict.files["game.js"],
      await box.readBytes(`${WORKSPACE}/dist/game.js`)
    );
    assert.equal(text(verdict.files["index.html"]), littlejsHtml());
    assert.deepEqual(await unpacked(verdict.files[SOURCE_TAR]), {
      "game.ts": GAME,
    });
  }
);

const SF2_SKILL = readFileSync(
  path.join(
    import.meta.dirname,
    "../agent-home/.agents/skills/make-game/references/music-sf2.md"
  ),
  "utf-8"
);
const SCORE = `strings = inst("strings", pan=30)
harp = inst("harp", pan=100)
flute = inst("flute")
for bar in range(BARS):
    strings.note(bar * 4, 57, 4.2, 60)
    strings.note(bar * 4, 64, 4.2, 55)
    for k in range(8):
        harp.note(bar * 4 + k / 2, [45, 52, 57, 60][k % 4], 0.6, 70)
    flute.note(bar * 4 + 1, 76 + bar % 3, 2, 90)
    drum(bar * 4, 36)
    drum(bar * 4 + 2, 54, 60)
flute.note(LENGTH_BEATS - 1, 81, 3, 100)
`;
// The skeleton leaves its tempo, meter and length to the design, and is a syntax error until they are set.
const MUSIC_PY = (
  /```python\n(?<code>[\s\S]*?)```/u.exec(SF2_SKILL)?.groups?.code ?? ""
)
  .replace(
    "# … write the score: parts, chords, bass, melody, percussion …\n",
    SCORE
  )
  .replace(/^BPM = {2}#.*$/mu, "BPM = 120")
  .replace(/^BEATS_PER_BAR = {2}#.*$/mu, "BEATS_PER_BAR = 4")
  .replace(/^BARS = {2}#.*$/mu, "BARS = 16");
const WAV_HEADER = 44;

test(
  "the music-sf2 skeleton renders a stereo loop that wraps without a jump, and a game's music.py becomes the music.opus its page names",
  { skip, timeout: 300_000 },
  async () => {
    assert.ok(
      MUSIC_PY.includes(SCORE),
      "the skill has a skeleton with a place for the score"
    );
    await restore(box, files({ "game.ts": GAME, "music.py": MUSIC_PY }));
    const rendered = await box.exec(["/usr/bin/python3", "music.py"]);
    assert.equal(rendered.exitCode, 0, rendered.stderr);
    const wav = Buffer.from(await box.readBytes(`${WORKSPACE}/music.wav`));
    assert.equal(wav.readUInt16LE(22), 2);
    assert.equal(wav.readUInt32LE(24), 44_100);
    const left = Array.from({ length: (wav.length - WAV_HEADER) / 4 }, (_, i) =>
      wav.readInt16LE(WAV_HEADER + i * 4)
    );
    assert.ok(left.length / 44_100 >= 20 && left.length / 44_100 <= 40);
    const steps = left
      .slice(1)
      .map((v, i) => Math.abs(v - (left[i] ?? 0)))
      .toSorted((a, b) => a - b);
    const typical = steps[Math.floor(steps.length * 0.99)] ?? 0;
    const seam = Math.abs((left[0] ?? 0) - (left.at(-1) ?? 0));
    assert.ok(seam <= typical, `seam ${seam}, 99th-percentile step ${typical}`);

    const verdict = await checkBuild(box, { music: true });

    assert.ok("files" in verdict, JSON.stringify(verdict));
    const source = await unpacked(verdict.files[SOURCE_TAR]);
    assert.equal(source["music.py"], MUSIC_PY);
    assert.equal(text(verdict.files["music.opus"]).slice(0, 4), "OggS");
    assert.equal(
      text(verdict.files["index.html"]),
      littlejsHtml({ music: "music.opus" })
    );
  }
);

test(
  "a game with both music.mjs and music.py fails the check of a music job",
  { skip, timeout: 300_000 },
  async () => {
    await restore(
      box,
      files({
        "game.ts": GAME,
        "music.mjs": "// a loop",
        "music.py": MUSIC_PY,
      })
    );

    const verdict = await checkBuild(box, { music: true });

    assert.ok("errors" in verdict);
    assert.match(verdict.errors.join("\n"), /both there/u);
  }
);

const OCEAN = path.join(import.meta.dirname, "../eval/revisions/ocean-memory");
const ocean = (file: string) => readFileSync(path.join(OCEAN, file), "utf-8");

test(
  "a plain-DOM game from before source.tgz, on /dom/v1.js with music.js, runs on the current scaffold without it",
  { skip, timeout: 300_000 },
  async () => {
    await restore(
      box,
      files({
        "design.md": "# Ocean memory",
        "game.ts": ocean("game.ts"),
        "index.html": ocean("index.html").replace(
          "</script>",
          '</script><script src="music.js"></script>'
        ),
      })
    );

    const verdict = await checkBuild(box, noMusic);

    assert.ok("files" in verdict, JSON.stringify(verdict));
    const page = text(verdict.files["index.html"]);
    assert.match(page, new RegExp(`<script src="${DOM_SRC}"></script>`, "u"));
    assert.doesNotMatch(page, /dom\/v1|music\.js/u);
    const source = await unpacked(verdict.files[SOURCE_TAR]);
    assert.equal(source["design.md"], "# Ocean memory");
  }
);

test(
  "source.tgz is the workspace's source, the same bytes for the same source, and restore puts back exactly it",
  { skip, timeout: 300_000 },
  async () => {
    const source = {
      "design.md": "# Fruit\nMusic: a harbour town",
      "game.ts": GAME,
      "levels/one.ts": "export const one = 1;\n",
      "sfx/hit.wav": "RIFF",
      "sfx/theme.mid": "MThd",
      "tests.json": '{"expose":[],"tests":[]}',
    };
    await restore(box, files(source));
    await bash(
      "mkdir -p dist .hopon && echo built > dist/game.js && echo x > music.wav && echo x > raw.wav && echo x > song.mid && echo x > music.opus && echo '[]' > .hopon/asked.json && echo png > playtest-end.png && echo stale > game.js"
    );
    const tar = await packSource(box);
    assert.deepEqual(await unpacked(tar), source);
    await bash("touch game.ts design.md && sleep 1 && touch levels/one.ts");
    assert.deepEqual(
      await packSource(box),
      tar,
      "the same source, the same bytes"
    );

    await bash("echo left over > old.ts");
    await restore(box, { tar });

    const listed = await bash("find . -type f | sort");
    assert.equal(
      listed.stdout.toString(),
      "./design.md\n./game.ts\n./levels/one.ts\n./sfx/hit.wav\n./sfx/theme.mid\n./tests.json\n"
    );
    const owner = await bash("stat -c %u game.ts");
    assert.equal(owner.stdout.toString().trim(), "1001");
  }
);

test(
  "a game of modules, a stylesheet and an SVG it imports is built into one page that loads them",
  { skip, timeout: 300_000 },
  async () => {
    await restore(
      box,
      files({
        "game.ts": `import "./style.css";\nimport star from "./star.svg";\nimport { speed } from "./speed.ts";\nconst img = new Image();\nimg.src = star;\nconst testVars = { get drawn() { return img.naturalWidth; }, get outline() { return getComputedStyle(document.body).outlineStyle; }, speed };\n${GAME}`,
        "speed.ts": "export const speed = 3;\n",
        "star.svg":
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="gold"/></svg>',
        "style.css": "body { outline: 3px solid gold; }\n",
      })
    );

    const verdict = await checkBuild(box, {
      music: false,
      tests: {
        expose: [],
        tests: [
          {
            checks: [
              {
                at: 1000,
                expect:
                  'vars.speed === 3 && vars.drawn > 0 && vars.outline === "solid"',
              },
            ],
            inputs: [],
            name: "the modules and the image load",
          },
        ],
      },
    });

    assert.ok("files" in verdict, JSON.stringify(verdict));
    const names = Object.keys(verdict.files);
    assert.ok(names.includes("game.css"), names.join(" "));
    assert.ok(
      names.some((name) => /^star-\w+\.svg$/u.test(name)),
      names.join(" ")
    );
    assert.equal(
      text(verdict.files["index.html"]),
      littlejsHtml({ css: "game.css" })
    );
  }
);

test(
  "a game.ts that exports fails the check: the page runs it as a plain script",
  { skip, timeout: 300_000 },
  async () => {
    await restore(box, files({ "game.ts": `${GAME}\nexport const x = 1;\n` }));

    const verdict = await checkBuild(box, noMusic);

    assert.ok("errors" in verdict, JSON.stringify(verdict));
    assert.match(verdict.errors.join("\n"), /must not export anything/u);
  }
);

// Ends the processes a test left running in the box, by what their command line says.
const kill = async (marker: string) => {
  await docker([
    "exec",
    container,
    "/usr/local/bin/node",
    "-e",
    `const fs = require('fs'); for (const p of fs.readdirSync('/proc')) { try { if (Number(p) !== process.pid && fs.readFileSync('/proc/' + p + '/cmdline', 'utf-8').includes(${JSON.stringify(marker)})) process.kill(Number(p), 'SIGKILL') } catch {} }`,
  ]);
};

test(
  "a source over 5 MB packed fails the check, and the harness never reads it back",
  { skip, timeout: 300_000 },
  async () => {
    await restore(box, files({ "game.ts": GAME }));
    await bash("head -c 6000000 /dev/urandom > noise.bin");
    const recorder = recording();

    const verdict = await checkBuild(recorder.box, noMusic);

    assert.ok("errors" in verdict, JSON.stringify(verdict));
    assert.match(
      verdict.errors.join("\n"),
      /the workspace's source is 6\.0 MB packed, over 5 MB/u
    );
    assert.deepEqual(recorder.read, []);
  }
);

test(
  "a built game over 5 MB fails the check, and the harness reads none of its files",
  { skip, timeout: 300_000 },
  async () => {
    await restore(
      box,
      files({
        "game.ts": `import big from "./big.svg";\nconst img = new Image();\nimg.src = big;\n${GAME}`,
      })
    );
    await bash(
      `{ printf '<svg xmlns="http://www.w3.org/2000/svg"><!--'; head -c 6000000 /dev/zero | tr '\\0' a; printf -- '--></svg>'; } > big.svg`
    );
    const recorder = recording();

    const verdict = await checkBuild(recorder.box, noMusic);

    assert.ok("errors" in verdict, JSON.stringify(verdict));
    assert.match(
      verdict.errors.join("\n"),
      /the built game is 6\.0 MB, over 5 MB/u
    );
    assert.deepEqual(
      recorder.read.filter((file) => file.startsWith(`${WORKSPACE}/dist/`)),
      []
    );
  }
);

test(
  "a file in dist/ whose name holds a newline fails the check, and can't hide the rest of a game over 5 MB",
  { skip, timeout: 300_000 },
  async () => {
    await restore(box, files({ "game.ts": GAME }));
    // A process the model left, writing into dist/ once the build has made it.
    await docker([
      "exec",
      "-d",
      ...USER,
      container,
      "sh",
      "-c",
      `cd /workspace; while :; do if [ -d dist ] && [ ! -e dist/z ]; then head -c 6000000 /dev/zero > /tmp/big.bin && mv /tmp/big.bin dist/big.bin; : > 'dist/a\nxy z'; : > dist/a; : > dist/z; fi; sleep 0.05; done`,
    ]);

    try {
      const verdict = await checkBuild(box, noMusic);

      assert.ok("errors" in verdict, JSON.stringify(Object.keys(verdict)));
      assert.match(verdict.errors.join("\n"), /rename a\nxy z/u);
    } finally {
      await kill("dist/big.bin");
    }
  }
);

// The box, with one file grown to 6 MB between the harness's measuring it and reading it.
const grown = (grows: string) => {
  let reads = 0;
  const wrapped: Box = {
    ...box,
    readBytes: async (file) => {
      if (file === grows) {
        reads += 1;
        return new Uint8Array(6_000_000);
      }
      return await box.readBytes(file);
    },
  };
  return { box: wrapped, reads: () => reads };
};

test(
  "a source that grows past 5 MB after it was measured fails the check",
  { skip, timeout: 300_000 },
  async () => {
    await restore(box, files({ "game.ts": GAME }));
    const source = grown("/tmp/hopon-source.tgz");

    const verdict = await checkBuild(source.box, noMusic);

    assert.ok(source.reads() > 0, "the harness read the packed source");
    assert.ok("errors" in verdict, JSON.stringify(Object.keys(verdict)));
    assert.match(
      verdict.errors.join("\n"),
      /the workspace's source is 6\.0 MB packed, over 5 MB/u
    );
  }
);

test(
  "a built file that grows past 5 MB after it was listed fails the check",
  { skip, timeout: 300_000 },
  async () => {
    await restore(box, files({ "game.ts": GAME }));
    const built = grown(`${WORKSPACE}/dist/game.js`);

    const verdict = await checkBuild(built.box, noMusic);

    assert.ok(built.reads() > 0, "the harness read the built game.js");
    assert.ok("errors" in verdict, JSON.stringify(Object.keys(verdict)));
    assert.match(
      verdict.errors.join("\n"),
      /the built game is 6\.0 MB, over 5 MB/u
    );
  }
);

test(
  "a plain-DOM page that loads /hopon/v2.js fails the check: only a Vite game's page gets that scaffold",
  { skip, timeout: 300_000 },
  async () => {
    await restore(
      box,
      files({
        "design.md": "# Ocean memory",
        "game.ts": ocean("game.ts"),
        "index.html": ocean("index.html").replace(
          "</body>",
          '<script src="/hopon/v2.js"></script></body>'
        ),
      })
    );

    const verdict = await checkBuild(box, noMusic);

    assert.ok("errors" in verdict, JSON.stringify(Object.keys(verdict)));
    assert.match(verdict.errors.join("\n"), /404/u);
  }
);

test(
  "a LittleJS game from before source.tgz restores without the harness's v3 page, and its change builds on the current one",
  { skip, timeout: 300_000 },
  async () => {
    await restore(
      box,
      files({
        "design.md": "# Fruit",
        "game.ts": GAME,
        "index.html":
          '<!doctype html><html><head><meta charset="utf-8"></head><body><script src="/runtime/v3.js"></script><script src="music.js"></script><script src="game.js"></script></body></html>',
      })
    );
    const listed = await bash("find . -type f | sort");
    assert.equal(listed.stdout.toString(), "./design.md\n./game.ts\n");
    await box.write(`${WORKSPACE}/game.ts`, withLine("const changed = 1;"));

    const verdict = await checkBuild(box, noMusic);

    assert.ok("files" in verdict, JSON.stringify(verdict));
    assert.equal(text(verdict.files["index.html"]), littlejsHtml());
    assert.deepEqual(
      Object.keys(await unpacked(verdict.files[SOURCE_TAR])).toSorted(),
      ["design.md", "game.ts"]
    );
  }
);

test(
  "a file that changes while the harness packs it fails the check as a changed workspace",
  { skip, timeout: 300_000 },
  async () => {
    await restore(box, files({ "game.ts": GAME }));
    await bash("head -c 3000000 /dev/zero > grows.txt");
    await docker([
      "exec",
      "-d",
      ...USER,
      container,
      "sh",
      "-c",
      "cd /workspace; while :; do echo grows >> grows.txt; done",
    ]);

    try {
      const verdict = await checkBuild(box, noMusic);

      assert.ok("errors" in verdict, JSON.stringify(verdict));
      assert.match(
        verdict.errors.join("\n"),
        /the workspace changed while the harness ran it/u
      );
    } finally {
      await kill("grows.txt");
    }
  }
);

const MAKE_GAME = readFileSync(
  path.join(
    import.meta.dirname,
    "../agent-home/.agents/skills/make-game/SKILL.md"
  ),
  "utf-8"
);

test(
  "make-game's Start over empties the workspace of the old game, all but what the Creator said",
  { skip, timeout: 300_000 },
  async () => {
    const command = /Start over.*\n+ *```bash\n *(?<command>.+)\n *```/u.exec(
      MAKE_GAME
    )?.groups?.command;
    assert.ok(command, "make-game gives Start over's command");
    await restore(
      box,
      files({
        ".hopon/asked.json": '["Start over"]',
        "balloon.svg": "<svg/>",
        "design.md": "# Balloons",
        "game.ts": GAME,
        "levels/one.ts": "export const one = 1;\n",
        "notes.txt": "scratch",
        "style.css": "body {}",
      })
    );
    await bash("mkdir -p dist && echo built > dist/game.js && echo x > .env");

    const ran = await bash(command);

    assert.equal(ran.exitCode, 0, ran.stderr.toString());
    const listed = await bash("find . -mindepth 1 | sort");
    assert.equal(
      listed.stdout.toString(),
      "./.hopon\n./.hopon/asked.json\n./index.html\n./src\n./src/main.tsx\n./tsconfig.json\n./vite.config.ts\n",
      "only what the Creator said, and the starter's skeleton"
    );
    const asked = await bash("cat .hopon/asked.json");
    assert.equal(asked.stdout.toString(), '["Start over"]');
  }
);

test(
  "Start over keeps the design that design_game wrote, and no old game's design",
  { skip, timeout: 300_000 },
  async () => {
    const command = /Start over.*\n+ *```bash\n *(?<command>.+)\n *```/u.exec(
      MAKE_GAME
    )?.groups?.command;
    assert.ok(command, "make-game gives Start over's command");
    await restore(
      box,
      files({
        ".hopon/design.md": "# Voyage",
        "design.md": "# Balloons",
        "game.ts": GAME,
      })
    );
    const ran = await bash(command);
    assert.equal(ran.exitCode, 0, ran.stderr.toString());
    assert.match(ran.stdout.toString(), /Kept design\.md/u);
    const kept = await bash("cat design.md");
    assert.equal(kept.stdout.toString(), "# Voyage");

    // The Worker empties its copy at each run's start: a game with no designer gets no design.
    await restore(
      box,
      files({
        ".hopon/design.md": "",
        "design.md": "# Balloons",
        "game.ts": GAME,
      })
    );
    await bash(command);
    const none = await bash("test -e design.md");
    assert.equal(none.exitCode, 1, "no design.md");
  }
);

test(
  "the starter seeds only a workspace with no game, and never writes over one",
  { skip, timeout: 300_000 },
  async () => {
    for (const game of ["game.ts", "vite.config.ts"]) {
      // oxlint-disable-next-line no-await-in-loop -- one workspace at a time
      await restore(box, files({ [game]: "// the Creator's game\n" }));
      // oxlint-disable-next-line no-await-in-loop -- one workspace at a time
      const ran = await bash("node /opt/hopon/starter.js");
      assert.equal(ran.exitCode, 1, game);
      // oxlint-disable-next-line no-await-in-loop -- one workspace at a time
      const listed = await bash("find . -mindepth 1 | sort");
      assert.equal(listed.stdout.toString(), `./${game}\n`, game);
    }
  }
);

test(
  "the starter's panels add the bridge to a new game or to a Vite game without one, and never write over it",
  { skip, timeout: 300_000 },
  async () => {
    await restore(box, files({}));
    const fresh = await bash("node /opt/hopon/starter.js panels");
    assert.equal(fresh.exitCode, 0, fresh.stderr.toString());
    const listed = await bash("find . -mindepth 1 | sort");
    assert.equal(
      listed.stdout.toString(),
      "./index.html\n./src\n./src/main.tsx\n./src/panels.tsx\n./tsconfig.json\n./vite.config.ts\n"
    );

    await restore(
      box,
      files({ "src/main.tsx": "// the game\n", "vite.config.ts": "// vite\n" })
    );
    const added = await bash("node /opt/hopon/starter.js panels");
    assert.equal(added.exitCode, 0, added.stderr.toString());
    const main = await bash("cat src/main.tsx && test -s src/panels.tsx");
    assert.equal(main.stdout.toString(), "// the game\n");
    assert.equal(main.exitCode, 0);

    await bash("echo kept > src/panels.tsx");
    const again = await bash("node /opt/hopon/starter.js panels");
    assert.equal(again.exitCode, 1);
    const kept = await bash("cat src/panels.tsx");
    assert.equal(kept.stdout.toString(), "kept\n");

    await restore(box, files({ "game.ts": "// an old game\n" }));
    const old = await bash("node /opt/hopon/starter.js panels");
    assert.equal(old.exitCode, 1);
  }
);

// Each engine guide's example (make-game's references), on the starter's skeleton as make-game's new-game command
// leaves it: the guide's files are the game's own, and its tests.json is the example's.
const REFERENCES = path.join(
  import.meta.dirname,
  "../agent-home/.agents/skills/make-game/references"
);
const guideExample = (engine: string) => {
  const guide = readFileSync(path.join(REFERENCES, `${engine}.md`), "utf-8");
  const example = guide.slice(Math.max(guide.indexOf("\n## Example"), 0));
  return Object.fromEntries(
    [
      ...example.matchAll(
        /^(?:### )?`(?<file>[\w./-]+)`:?\n\n```\w*\n(?<code>[\s\S]*?)\n```$/gmu
      ),
    ].map((match) => [match.groups?.file, `${match.groups?.code}\n`])
  ) as Record<string, string>;
};
for (const engine of [
  "phaser-example",
  "phaser-scenes",
  "phaser-panels-example",
  "r3f",
  "react",
]) {
  test(
    `the ${engine} guide's example builds on the starter's skeleton, passes its tests and plays green`,
    { skip, timeout: 300_000 },
    async () => {
      const command = /Start over.*\n+ *```bash\n *(?<command>.+)\n *```/u.exec(
        MAKE_GAME
      )?.groups?.command;
      const example = guideExample(engine);
      assert.ok(example["src/main.tsx"] && example["tests.json"], engine);
      await restore(box, files({ ".hopon/asked.json": "[]" }));
      const panels = engine === "phaser-panels-example" ? " panels" : "";
      const seeded = await bash(`${command ?? "false"}${panels}`);
      assert.equal(seeded.exitCode, 0, seeded.stderr.toString());
      const { "tests.json": tests = "", ...own } = example;
      await bash(
        `mkdir -p ${[...new Set(Object.keys(own).map((file) => path.dirname(file)))].join(" ")}`
      );
      for (const [file, code] of Object.entries(own)) {
        // oxlint-disable-next-line no-await-in-loop -- one file at a time
        await box.write(`${WORKSPACE}/${file}`, code);
      }

      const verdict = await checkBuild(box, {
        music: false,
        tests: JSON.parse(tests) as Tests,
      });

      assert.ok("files" in verdict, JSON.stringify(verdict));
      assert.deepEqual(verdict.testErrors, []);
      const played = await boxPlaytest(box, "random");
      assert.equal(played.ok, true, JSON.stringify(played));
    }
  );
}

// Vite games (ADR 0007): one fixture per engine, a workspace as the agent will leave it, checked and playtested by the
// harness in the box with no network, its libraries left as imports of the Worker's vendor files.
const VITE = path.join(import.meta.dirname, "../fixtures/vite");
const fixture = (engine: string) => {
  const dir = path.join(VITE, engine);
  return Object.fromEntries(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = path.join(entry.parentPath, entry.name);
        return [path.relative(dir, file), readFileSync(file, "utf-8")];
      })
  );
};
const fixtureTests = (engine: string): Tests =>
  JSON.parse(fixture(engine)["tests.json"] ?? "");
// A built game's own files, gzipped, stay under this (the plan's rule): the libraries aren't in them.
const OWN_GZIP_BYTES = 10_000;

interface Loaded {
  after: { overlay: string; state: string };
  before: { origin: string; overlay: string; state: string };
  errors: string[];
  loaded: boolean;
  ownGzipBytes: number;
  requested: string[];
  tapped: { testVars: Record<string, unknown> };
}

// The built game in the workspace's dist/, served by a real HTTP server in the box as the Worker serves it.
const loadVite = async (...flags: string[]) => {
  await box.write(
    "/tmp/load.mjs",
    readFileSync(path.join(VITE, "load.mjs"), "utf-8")
  );
  const result = await box.exec([
    "/usr/local/bin/node",
    "/tmp/load.mjs",
    `${WORKSPACE}/dist`,
    GAME_CSP,
    ...flags,
  ]);
  assert.equal(result.exitCode, 0, result.stderr);
  return JSON.parse(result.stdout) as Loaded;
};

test(
  "the box's playtest serves the vendor files the Worker serves, byte for byte",
  { skip, timeout: 300_000 },
  async () => {
    const image = JSON.parse(await box.read("/opt/hopon/vendor.json")) as {
      files: Record<string, string>;
      paths: Record<string, string>;
    };

    assert.deepEqual(
      Object.fromEntries(
        Object.entries(image.files).map(([route, gzip]) => [
          route,
          createHash("sha256")
            .update(gunzipSync(Buffer.from(gzip, "base64")))
            .digest("hex"),
        ])
      ),
      Object.fromEntries(FROZEN.map(({ route, sha256 }) => [route, sha256]))
    );
    assert.deepEqual(image.paths, vendorPaths());
  }
);

for (const [engine, libs] of [
  ["quiz", ["react", "react-dom"]],
  ["phaser", ["phaser"]],
  ["r3f", ["r3f", "react", "react-dom", "three"]],
] as const) {
  test(
    `a ${engine} Vite game passes the check offline on the vendor files: its tests, a 10 s playtest, and a Revision of its source and its flat dist/`,
    { skip, timeout: 300_000 },
    async (t) => {
      const source = fixture(engine);
      // The quiz has music, which its page names on the scaffold's tag.
      const music = engine === "quiz";
      await restore(
        box,
        files(music ? { ...source, "music.py": MUSIC_PY } : source)
      );
      await bash(
        "mkdir -p dist node_modules/.vite && echo old > dist/old.js && echo cache > node_modules/.vite/deps.json"
      );

      const verdict = await checkBuild(box, {
        music,
        tests: fixtureTests(engine),
      });

      assert.ok("files" in verdict, JSON.stringify(verdict));
      assert.deepEqual(verdict.testErrors, []);
      const names = Object.keys(verdict.files).toSorted();
      assert.deepEqual(
        names.map((name) => name.replace(/^index-[\w-]+\.js$/u, "index-*.js")),
        [
          "index-*.js",
          "index.html",
          ...(music ? ["music.opus"] : []),
          SOURCE_TAR,
        ],
        "the page, its one module and the music, flat"
      );
      assert.deepEqual(
        Object.keys(await unpacked(verdict.files[SOURCE_TAR])).toSorted(),
        Object.keys(music ? { ...source, "music.py": "" } : source).toSorted(),
        "source.tgz holds the source, with no dist/ and no node_modules/"
      );
      assert.match(
        text(verdict.files["index.html"]),
        music
          ? /<script src="\/hopon\/v2\.js" data-music="music\.opus"><\/script>/u
          : /<script src="\/hopon\/v2\.js"><\/script>/u
      );

      const played = await boxPlaytest(box, "random");

      assert.equal(played.ok, true, JSON.stringify(played));
      t.diagnostic(`playtest timings ${JSON.stringify(played.timings)}`);
      const page = await loadVite();
      assert.deepEqual(page.errors, []);
      assert.ok(page.loaded, "the game called hopon.ready()");
      assert.equal(page.before.origin, "null", "the CSP sandboxes the page");
      assert.equal(page.before.state, "start");
      assert.equal(page.after.state, "play");
      assert.equal(page.after.overlay, "none");
      if (engine === "phaser") {
        assert.equal(
          page.tapped.testVars.taps,
          3,
          "Phaser takes each tap after the start tap, each touch a new identifier as on iOS"
        );
      }
      assert.ok(
        page.ownGzipBytes < OWN_GZIP_BYTES,
        `own files ${page.ownGzipBytes} B gzip`
      );
      t.diagnostic(`own files ${page.ownGzipBytes} B gzip`);
      assert.deepEqual(
        page.requested
          .filter((requested) => requested.startsWith("/vendor/"))
          .map((requested) =>
            requested.replace(/^\/vendor\/(?<lib>.+)-[\d.]+\.js$/u, "$<lib>")
          )
          .toSorted(),
        libs,
        "each library once, from its vendor file"
      );
    }
  );
}

test(
  "a Vite game whose loop ignores the feed's pause fails its pause test",
  { skip, timeout: 300_000 },
  async () => {
    const source = fixture("phaser");
    await restore(
      box,
      files({
        ...source,
        "src/main.tsx": (source["src/main.tsx"] ?? "").replace(
          "hopon.subscribe(follow);",
          ""
        ),
      })
    );

    const verdict = await checkBuild(box, {
      music: false,
      tests: fixtureTests("phaser"),
    });

    assert.ok("errors" in verdict, JSON.stringify(verdict));
    assert.match(
      verdict.errors.join("\n"),
      /at 1700 ms, expected vars\.frames === prev\.vars\.frames/u
    );
  }
);

test(
  "a Vite game that builds a vendored library into itself fails the check, and so does one that never calls hopon.ready()",
  { skip, timeout: 300_000 },
  async () => {
    const source = fixture("quiz");
    const main = source["src/main.tsx"] ?? "";
    await restore(
      box,
      files({
        ...source,
        "src/main.tsx": `import "react/jsx-dev-runtime";\n${main}`,
      })
    );

    const bundled = await checkBuild(box, noMusic);

    assert.ok("errors" in bundled, JSON.stringify(bundled));
    assert.match(
      bundled.errors.join("\n"),
      /react built into the game: import only react, react\/jsx-runtime/u
    );

    await restore(
      box,
      files({
        ...source,
        "src/main.tsx": main
          .replace("useEffect(() => hopon.ready(), []);", "")
          .replace("useEffect, ", ""),
      })
    );

    const tests = fixtureTests("quiz");
    const began = Date.now();

    const silent = await checkBuild(box, {
      music: false,
      tests: {
        ...tests,
        tests: [1, 2, 3].flatMap(() =>
          tests.tests.map((one, n) => ({ ...one, name: `${one.name} ${n}` }))
        ),
      },
    });

    const tookMs = Date.now() - began;
    assert.ok("errors" in silent, JSON.stringify(silent));
    assert.deepEqual(
      silent.errors.filter((error) => error.includes("hopon.ready()")),
      [
        'test "the game runs": the game didn\'t call hopon.ready() within 10 s of loading',
      ]
    );
    assert.ok(
      tookMs < 25_000,
      `a game that never loads fails once, not once per test: ${tookMs} ms`
    );
  }
);

// A Vite game on the quiz's page, config and tsconfig, with its own src/main.tsx and files.
const viteGame = (main: string, more: Record<string, string> = {}) => ({
  ...fixture("quiz"),
  "src/main.tsx": main,
  ...more,
});

// A React game that counts on a timer every 100 ms or on every animation frame: the count it renders is vars.shown,
// the count itself vars.counted, and vars.behind the most counts the screen was behind at a tick, which a browser
// renders in between.
const counter = (start: string, stop: string) =>
  viteGame(`import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

let counted = 0;
let rendered = 0;
hopon.testVars.behind = 0;
const Counter = () => {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    hopon.ready();
    const tick = () => {
      hopon.testVars.behind = Math.max(Number(hopon.testVars.behind), counted - rendered);
      counted += 1;
      hopon.testVars.counted = counted;
      setShown(counted);
    };
    ${start}
    return () => ${stop};
  }, []);
  rendered = shown;
  hopon.testVars.shown = shown;
  return <p style={{ color: "#fff" }}>{shown}</p>;
};

const root = document.querySelector("#root");
if (root) {
  createRoot(root).render(<Counter />);
}
`);

for (const [on, start, stop] of [
  ["a timer", "const id = setInterval(tick, 100);", "clearInterval(id)"],
  [
    "an animation frame",
    "let id = requestAnimationFrame(function step() { tick(); id = requestAnimationFrame(step); });",
    "cancelAnimationFrame(id)",
  ],
] as const) {
  test(
    `a React game's state set on ${on} renders on the tests' fake clock`,
    { skip, timeout: 300_000 },
    async () => {
      await restore(box, files(counter(start, stop)));

      const verdict = await checkBuild(box, {
        music: false,
        tests: {
          expose: [],
          tests: [
            {
              checks: [250, 1000, 1050, 1730, 3000].map((at) => ({
                at,
                expect:
                  "vars.counted > 1 && vars.behind === 0 && vars.shown === vars.counted",
              })),
              inputs: [],
              name: "the count on screen is the count",
            },
          ],
        },
      });

      assert.ok("files" in verdict, JSON.stringify(verdict));
    }
  );
}

// A quiz screen 620 px tall with a 300 px picture, or with the picture shrinking (`flex: 1 1 0`) to fit the frame.
const answers = (picture: string) =>
  viteGame(`import { createRoot } from "react-dom/client";

const root = document.querySelector("#root");
if (root) {
  createRoot(root).render(
    <main style={{ boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12, height: "100dvh", overflow: "hidden", padding: 16 }}>
      <div style={{ ${picture}, background: "#468" }} />
      {["Mercury", "Venus", "Earth", "Mars"].map((name) => (
        <button key={name} style={{ flex: "none", minHeight: 60 }} type="button">{name}</button>
      ))}
    </main>
  );
  hopon.ready();
}
`);

test(
  "a playtest fails a game whose last answer is below a short screen, and passes it once the picture shrinks",
  { skip, timeout: 300_000 },
  async () => {
    await restore(box, files(answers('flex: "none", height: 300')));

    const clipped = await boxPlaytest(box, "{}");

    assert.equal(clipped.ok, false);
    assert.match(
      clipped.errors.join("\n"),
      /on a 360×540 screen.*off the screen and can't be tapped: "Mars"\./u
    );
    assert.doesNotMatch(clipped.errors.join("\n"), /"Earth"/u);

    await restore(box, files(answers('flex: "1 1 0", minHeight: 0')));

    const fits = await boxPlaytest(box, "{}");

    assert.doesNotMatch(fits.errors.join("\n"), /off the screen/u);
  }
);

const PUB_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="gold"/></svg>';
const loadsPub = (src: string) =>
  viteGame(
    `const img = new Image();
img.onload = () => {
  hopon.testVars.width = img.naturalWidth;
  hopon.ready();
};
img.src = "${src}";
`,
    { "public/pub.svg": PUB_SVG }
  );
const pubTests: Tests = {
  expose: [],
  tests: [
    {
      checks: [{ at: 100, expect: "vars.width === 10" }],
      inputs: [],
      name: "the picture loads",
    },
  ],
};

test(
  "a Vite game plays under a path as on the phone: a file by its absolute path fails the check, and by a relative one passes",
  { skip, timeout: 300_000 },
  async () => {
    await restore(box, files(loadsPub("/pub.svg")));

    const absolute = await checkBuild(box, { music: false, tests: pubTests });

    assert.ok("errors" in absolute, JSON.stringify(absolute));
    assert.match(
      absolute.errors.join("\n"),
      /the game didn.t call hopon\.ready\(\)/u
    );

    await restore(box, files(loadsPub("./pub.svg")));

    const relative = await checkBuild(box, { music: false, tests: pubTests });

    assert.ok("files" in relative, JSON.stringify(relative));
    assert.ok("pub.svg" in relative.files);
  }
);

test(
  "a Vite game's own .wav and .glb stay in its source and are served typed, as the Worker serves them",
  { skip, timeout: 300_000 },
  async () => {
    // Over Vite's 4 KB inline limit, so each is a file of its own.
    const big = "x".repeat(5000);
    await restore(
      box,
      files(
        viteGame(
          `import hit from "./sfx/hit.wav";
import ship from "./ship.glb";

Promise.all(
  [hit, ship].map(async (url) => (await fetch(url)).headers.get("content-type"))
).then((types) => {
  hopon.testVars.types = types.join();
  hopon.ready();
});
`,
          { "src/sfx/hit.wav": `RIFF${big}`, "src/ship.glb": `glTF${big}` }
        )
      )
    );

    const verdict = await checkBuild(box, {
      music: false,
      tests: {
        expose: [],
        tests: [
          {
            checks: [
              {
                at: 100,
                expect: "vars.types === 'audio/wav,model/gltf-binary'",
              },
            ],
            inputs: [],
            name: "the sound and the model are served typed",
          },
        ],
      },
    });

    assert.ok("files" in verdict, JSON.stringify(verdict));
    assert.ok(
      Object.keys(verdict.files).some((name) => /^hit-[\w-]+\.wav$/u.test(name))
    );
    const source = await unpacked(verdict.files[SOURCE_TAR]);
    assert.equal(source["src/sfx/hit.wav"], `RIFF${big}`);
  }
);

// The smallest .glb three's GLTFLoader parses: its header and a JSON chunk with an empty scene.
const GLB_JSON = '{"asset":{"version":"2.0"},"scenes":[{}],"scene":0}'.padEnd(
  56
);
const u32 = (n: number) => String.fromCodePoint(n, 0, 0, 0);
const TINY_GLB = `glTF${u32(2)}${u32(20 + GLB_JSON.length)}${u32(GLB_JSON.length)}JSON${GLB_JSON}`;

test(
  "a Vite game's .wav and .glb under 4 KB load as on the phone, from files in dist/, not data: URLs its CSP refuses",
  { skip, timeout: 300_000 },
  async () => {
    const wav = `RIFF${"x".repeat(100)}`;
    await restore(
      box,
      files(
        viteGame(
          `import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import hit from "./sfx/hit.wav";
import ship from "./ship.glb";

Promise.all([
  fetch(hit).then(async (response) => (await response.arrayBuffer()).byteLength),
  new GLTFLoader().loadAsync(ship).then((gltf) => gltf.scenes.length),
]).then(
  ([bytes, scenes]) => {
    hopon.testVars.loaded = \`\${bytes} \${scenes}\`;
    hopon.ready();
  },
  (error: unknown) => {
    hopon.testVars.loaded = String(error);
    hopon.ready();
  }
);
`,
          { "src/sfx/hit.wav": wav, "src/ship.glb": TINY_GLB }
        )
      )
    );

    const verdict = await checkBuild(box, {
      music: false,
      tests: {
        expose: [],
        tests: [
          {
            checks: [{ at: 100, expect: `vars.loaded === '${wav.length} 1'` }],
            inputs: [],
            name: "the sound and the model load",
          },
        ],
      },
    });

    assert.ok("files" in verdict, JSON.stringify(verdict));
    const names = Object.keys(verdict.files);
    assert.ok(
      names.some((name) => /^hit-[\w-]+\.wav$/u.test(name)) &&
        names.some((name) => /^ship-[\w-]+\.glb$/u.test(name)),
      names.join(",")
    );
  }
);

test(
  "a Vite game whose build writes into a folder of dist/ fails the check, as the Worker serves only its top",
  { skip, timeout: 300_000 },
  async () => {
    const source = fixture("quiz");
    await restore(
      box,
      files({
        ...source,
        "src/main.tsx": `import "./style.css";\n${source["src/main.tsx"] ?? ""}`,
        "src/style.css": "h1 { color: gold; }\n",
        "vite.config.ts": `import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  build: { rolldownOptions: { output: { assetFileNames: "assets/[name]-[hash][extname]" } } },
  plugins: [react()],
});
`,
      })
    );

    const verdict = await checkBuild(box, noMusic);

    assert.ok("errors" in verdict, JSON.stringify(verdict));
    assert.match(verdict.errors.join("\n"), /status of 404/u);
  }
);

test(
  "a Vite game's build error names its file and line, with no terminal colours",
  { skip, timeout: 300_000 },
  async () => {
    await restore(
      box,
      files(
        viteGame(
          'import missing from "./missing.png";\n\nhopon.testVars.src = missing;\nhopon.ready();\n'
        )
      )
    );

    const verdict = await checkBuild(box, noMusic);

    assert.ok("errors" in verdict, JSON.stringify(verdict));
    const [error = ""] = verdict.errors;
    assert.match(
      error,
      /^src\/main\.tsx:1: .*Could not resolve '\.\/missing\.png'/u
    );
    assert.ok(!error.includes("\u001B"), "no terminal colour codes");
  }
);

test(
  "a Vite game whose tsconfig.json typechecks no file fails the check",
  { skip, timeout: 300_000 },
  async () => {
    const source = fixture("quiz");
    await restore(
      box,
      files({
        ...source,
        "src/main.tsx": `const wrong: number = "one";\n${source["src/main.tsx"] ?? ""}`,
        "tsconfig.app.json": source["tsconfig.json"] ?? "",
        "tsconfig.json":
          '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }\n',
      })
    );

    const verdict = await checkBuild(box, noMusic);

    assert.ok("errors" in verdict, JSON.stringify(verdict));
    assert.match(verdict.errors.join("\n"), /^tsconfig\.json: .*no files/mu);
  }
);

test(
  "a sandboxed game's page can't load the vendor files without Access-Control-Allow-Origin",
  { skip, timeout: 300_000 },
  async () => {
    await restore(box, files(fixture("quiz")));
    const verdict = await checkBuild(box, noMusic);
    assert.ok("files" in verdict, JSON.stringify(verdict));

    const page = await loadVite("--no-cors");

    assert.equal(page.loaded, false);
    assert.match(page.errors.join("\n"), /CORS|Access-Control-Allow-Origin/u);
  }
);

test(
  "the tap that starts a round is the scaffold's: its release and click never reach the game, and the next tap's do",
  { skip, timeout: 300_000 },
  async () => {
    await restore(
      box,
      files(
        viteGame(`hopon.testVars.ups = 0;
hopon.testVars.clicks = 0;
document.addEventListener("pointerup", () => { hopon.testVars.ups = Number(hopon.testVars.ups) + 1; });
document.addEventListener("click", () => { hopon.testVars.clicks = Number(hopon.testVars.clicks) + 1; });
const tick = () => { document.body.style.background = hopon.state === "play" ? "#123" : "#000"; requestAnimationFrame(tick); };
requestAnimationFrame(tick);
hopon.ready();
`)
      )
    );

    const verdict = await checkBuild(box, {
      music: false,
      tests: {
        expose: [],
        tests: [
          {
            checks: [
              {
                at: 100,
                expect:
                  "state === 'play' && vars.ups === 0 && vars.clicks === 0",
              },
              { at: 400, expect: "vars.ups === 1 && vars.clicks === 1" },
            ],
            inputs: [{ at: 200, type: "tap", x: 180, y: 500 }],
            name: "only the tap after the start reaches the game",
          },
        ],
      },
    });

    assert.ok("files" in verdict, JSON.stringify(verdict));
  }
);

test(
  "the start screen shows the title and hint a game sets after it first draws, and wraps a long word inside the screen",
  { skip, timeout: 300_000 },
  async () => {
    await restore(
      box,
      files(
        viteGame(`setTimeout(() => {
  hopon.title = "Supercalifragilisticexpialidociousness";
  hopon.hint = "Tap the moon";
}, 50);
const look = () => {
  const overlay = document.getElementById("hopon-overlay");
  if (hopon.state === "start" && overlay) {
    hopon.testVars.startText = overlay.textContent;
    hopon.testVars.fits = [...overlay.children].every((line) => {
      const { left, right } = line.getBoundingClientRect();
      return left >= 0 && right <= innerWidth;
    });
  }
  document.body.style.background = hopon.state === "play" ? "#123" : "#000";
  requestAnimationFrame(look);
};
requestAnimationFrame(look);
hopon.ready();
`)
      )
    );

    const verdict = await checkBuild(box, {
      music: false,
      tests: {
        expose: [],
        tests: [
          {
            checks: [
              {
                at: 100,
                expect:
                  "vars.startText.includes('Supercalifragilisticexpialidociousness') && vars.startText.includes('Tap the moon') && vars.fits === true",
              },
            ],
            inputs: [],
            name: "the late title and hint, wrapped",
          },
        ],
      },
    });

    assert.ok("files" in verdict, JSON.stringify(verdict));
  }
);

test(
  "a game's sound effects play through the scaffold, silent before the first touch and with no error after it",
  { skip, timeout: 300_000 },
  async () => {
    await restore(
      box,
      files(
        viteGame(`hopon.play({ freq: 440, ms: 100 });
hopon.testVars.played = 0;
document.addEventListener("pointerdown", () => {
  hopon.play({ freq: 990, ms: 70, volume: 0.2 });
  hopon.play({ delayMs: 70, freq: 600, ms: 300, to: 60, wave: "noise" });
  hopon.testVars.played = Number(hopon.testVars.played) + 1;
});
const tick = () => { document.body.style.background = hopon.state === "play" ? "#123" : "#000"; requestAnimationFrame(tick); };
requestAnimationFrame(tick);
hopon.ready();
`)
      )
    );

    const verdict = await checkBuild(box, {
      music: false,
      tests: {
        expose: [],
        tests: [
          {
            checks: [{ at: 400, expect: "vars.played === 1" }],
            inputs: [{ at: 200, type: "tap", x: 180, y: 500 }],
            name: "a tap plays two sounds",
          },
        ],
      },
    });

    assert.ok("files" in verdict, JSON.stringify(verdict));
  }
);

test(
  "a frame due at a timer's instant still runs: a second of game time is 60 frames with a 100 ms timer running",
  { skip, timeout: 300_000 },
  async () => {
    await restore(
      box,
      files(
        viteGame(`hopon.testVars.frames = 0;
hopon.testVars.ticks = 0;
setInterval(() => { hopon.testVars.ticks = Number(hopon.testVars.ticks) + 1; }, 100);
const step = () => { hopon.testVars.frames = Number(hopon.testVars.frames) + 1; document.body.style.opacity = String(0.5 + (Number(hopon.testVars.frames) % 2) / 2); requestAnimationFrame(step); };
requestAnimationFrame(step);
hopon.ready();
`)
      )
    );

    const verdict = await checkBuild(box, {
      music: false,
      tests: {
        expose: [],
        tests: [
          {
            checks: [
              { at: 500, expect: "vars.frames > 0" },
              {
                at: 1500,
                expect:
                  "vars.frames - prev.vars.frames >= 59 && vars.ticks - prev.vars.ticks === 10",
              },
            ],
            inputs: [],
            name: "60 frames and 10 ticks a second",
          },
        ],
      },
    });

    assert.ok("files" in verdict, JSON.stringify(verdict));
  }
);

test(
  "a game that throws in a frame fails the check with its error, and the harness doesn't crash",
  { skip, timeout: 300_000 },
  async () => {
    await restore(
      box,
      files(
        viteGame(`const step = () => { if (hopon.state === "play") { throw new Error("broken frame"); } requestAnimationFrame(step); };
requestAnimationFrame(step);
hopon.ready();
`)
      )
    );

    const verdict = await checkBuild(box, noMusic);

    assert.ok("errors" in verdict, JSON.stringify(verdict));
    assert.match(verdict.errors.join("\n"), /broken frame/u);
    assert.doesNotMatch(verdict.errors.join("\n"), /page\.evaluate/u);
  }
);

const PORT = path.join(import.meta.dirname, "../fixtures/port");
const portFixture = (game: string, side: "before" | "after") => {
  const dir = path.join(PORT, game, side);
  return Object.fromEntries(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = path.join(entry.parentPath, entry.name);
        return [path.relative(dir, file), readFileSync(file, "utf-8")];
      })
  );
};
const verifyChange = async (music: boolean) => {
  const result = await bash(
    `node /opt/hopon/verify.js change${music ? " --had-music" : ""}`
  );
  return JSON.parse(result.stdout.toString()) as {
    failures: string[];
    ok: boolean;
  };
};

// A LittleJS Draft with music and a plain-DOM one without, as make-game's references/old-game.md ports them: design.md,
// tests.json and the music kept.
for (const [game, engine, music] of [
  ["fruit-catcher", "phaser", true],
  ["ocean-memory", "react", false],
] as const) {
  test(
    `an old ${game} Draft fails verify until it is ported, and its ${engine} port passes its own tests and keeps its design, tests and music`,
    { skip, timeout: 300_000 },
    async () => {
      const old = portFixture(game, "before");
      const port = portFixture(game, "after");
      assert.equal(port["design.md"], old["design.md"]);
      assert.equal(port["tests.json"], old["tests.json"]);
      assert.ok(!("game.ts" in port) && "vite.config.ts" in port);
      const tests = JSON.parse(old["tests.json"] ?? "") as Tests;
      const score: Record<string, string> = music
        ? { "music.py": MUSIC_PY }
        : {};

      await restore(box, files({ ...old, ...score }));

      const refused = await verifyChange(music);
      assert.equal(refused.ok, false);
      assert.match(refused.failures.join("\n"), /port it to a Vite project/u);
      const original = await checkBuild(box, { music, tests });
      assert.ok("files" in original, JSON.stringify(original));

      await restore(box, files({ ...port, ...score }));

      assert.deepEqual(await verifyChange(music), { failures: [], ok: true });
      const ported = await checkBuild(box, { music, tests });
      assert.ok("files" in ported, JSON.stringify(ported));
      assert.deepEqual(ported.testErrors, []);
      assert.match(
        text(ported.files["index.html"]),
        music
          ? /<script src="\/hopon\/v2\.js" data-music="music\.opus"><\/script>/u
          : /<script src="\/hopon\/v2\.js"><\/script>/u
      );
      assert.equal("music.opus" in ported.files, music);
      const source = await unpacked(ported.files[SOURCE_TAR]);
      assert.deepEqual(
        Object.keys(source).toSorted(),
        Object.keys({ ...port, ...score }).toSorted()
      );
      assert.equal(source["design.md"], old["design.md"]);
      assert.equal(source["tests.json"], old["tests.json"]);
    }
  );
}
