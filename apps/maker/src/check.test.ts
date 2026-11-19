// The harness check (ADR 0006) on the real sandbox image, in Docker: what a model leaves behind can't pass a game that
// doesn't run, and the agent's tests decide a build. It needs the image, so it runs only
// with HOPON_BOX_IMAGE set, e.g. to one of `docker images cloudflare-dev/maker-box-*` after `pnpm -F worker dev:maker`.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buffer } from "node:stream/consumers";
import { after, before, test } from "node:test";

import { DOM_SRC, GAME_CSP, littlejsHtml } from "../image/page.ts";
import { FROZEN, servedCode, vendorPaths } from "../vendor/build.ts";
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
    "../agent-home/.agents/skills/music-sf2/SKILL.md"
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
const MUSIC_PY = (
  /```python\n(?<code>[\s\S]*?)```/u.exec(SF2_SKILL)?.groups?.code ?? ""
).replace(
  "# … write the score: parts, chords, bass, melody, percussion …\n",
  SCORE
);
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
      "./design.md\n./game.ts\n./levels/one.ts\n./tests.json\n"
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
  "a page that loads /hopon/v1.js fails the check: no Revision loads the scaffold before it is frozen",
  { skip, timeout: 300_000 },
  async () => {
    await restore(
      box,
      files({
        "design.md": "# Ocean memory",
        "game.ts": ocean("game.ts"),
        "index.html": ocean("index.html").replace(
          "</body>",
          '<script src="/hopon/v1.js"></script></body>'
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
    assert.equal(listed.stdout.toString(), "./.hopon\n./.hopon/asked.json\n");
    const asked = await bash("cat .hopon/asked.json");
    assert.equal(asked.stdout.toString(), '["Start over"]');
  }
);

// Vite games (ADR 0007): one fixture per engine, built in the box with no network, its libraries left as imports of
// the Worker's vendor files, then loaded with those files under the game CSP.
const VITE = path.join(import.meta.dirname, "../fixtures/vite");
const VITE_CONFIG = `import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const paths = ${JSON.stringify(vendorPaths())};

export default defineConfig({
  base: "./",
  build: { rolldownOptions: { external: Object.keys(paths), output: { paths } } },
  plugins: [react()],
});
`;
const VITE_TSCONFIG = JSON.stringify({
  compilerOptions: {
    jsx: "react-jsx",
    lib: ["es2022", "dom"],
    module: "esnext",
    moduleResolution: "bundler",
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: "es2022",
    types: [],
  },
  include: ["src", "/opt/hopon/hopon-v1.d.ts"],
});
// A built game's own files, gzipped, stay under this (the plan's rule): the libraries aren't in them.
const OWN_GZIP_BYTES = 10_000;

interface Loaded {
  after: { overlay: string; state: string; testVars: Record<string, unknown> };
  before: { origin: string; overlay: string; state: string };
  errors: string[];
  loaded: boolean;
  ownGzipBytes: number;
  requested: string[];
}

const writeVite = async () => {
  for (const { route } of FROZEN) {
    // oxlint-disable-next-line no-await-in-loop -- one file at a time
    await box.write(`/tmp${route}`, servedCode(route) ?? "");
  }
  await box.write(
    "/tmp/load.mjs",
    readFileSync(path.join(VITE, "load.mjs"), "utf-8")
  );
};

const buildVite = async (engine: string) => {
  const dir = `/tmp/vite/${engine}`;
  const fixture = path.join(VITE, engine);
  for (const file of readdirSync(fixture, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (file.isFile()) {
      const local = path.join(file.parentPath, file.name);
      // oxlint-disable-next-line no-await-in-loop -- one file at a time
      await box.write(
        `${dir}/${path.relative(fixture, local)}`,
        readFileSync(local, "utf-8")
      );
    }
  }
  await box.write(`${dir}/vite.config.ts`, VITE_CONFIG);
  await box.write(`${dir}/tsconfig.json`, VITE_TSCONFIG);
  return { built: await bash(`cd ${dir} && tsc -p . && vite build`), dir };
};

const loadVite = async (dir: string, ...flags: string[]) => {
  const result = await box.exec([
    "/usr/local/bin/node",
    "/tmp/load.mjs",
    `${dir}/dist`,
    "/tmp/vendor",
    GAME_CSP,
    ...flags,
  ]);
  assert.equal(result.exitCode, 0, result.stderr);
  return JSON.parse(result.stdout) as Loaded;
};

for (const [engine, libs] of [
  ["quiz", ["react", "react-dom"]],
  ["phaser", ["phaser"]],
  ["r3f", ["r3f", "react", "react-dom", "three"]],
] as const) {
  test(
    `a ${engine} game builds offline on the vendor files, and plays on them under the game CSP`,
    { skip, timeout: 300_000 },
    async () => {
      await writeVite();

      const { built, dir } = await buildVite(engine);

      assert.equal(built.exitCode, 0, `${built.stdout}${built.stderr}`);
      const page = await loadVite(dir);
      assert.deepEqual(page.errors, []);
      assert.ok(page.loaded, "the game called hopon.ready()");
      assert.equal(page.before.origin, "null", "the CSP sandboxes the page");
      assert.equal(page.before.state, "start");
      assert.equal(page.before.overlay, "flex");
      assert.equal(page.after.state, "play");
      assert.equal(page.after.overlay, "none");
      assert.ok(
        page.ownGzipBytes < OWN_GZIP_BYTES,
        `own files ${page.ownGzipBytes} B gzip`
      );
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
      if (engine === "quiz") {
        assert.equal(page.after.testVars.question, "2 + 2");
      } else {
        assert.ok(
          Number(page.after.testVars.frames) > 0,
          "the engine's loop ran"
        );
      }
    }
  );
}

test(
  "a sandboxed game's page can't load the vendor files without Access-Control-Allow-Origin",
  { skip, timeout: 300_000 },
  async () => {
    await writeVite();
    const { built, dir } = await buildVite("quiz");
    assert.equal(built.exitCode, 0, `${built.stdout}${built.stderr}`);

    const page = await loadVite(dir, "--no-cors");

    assert.equal(page.loaded, false);
    assert.match(page.errors.join("\n"), /CORS|Access-Control-Allow-Origin/u);
  }
);
