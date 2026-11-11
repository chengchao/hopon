// The harness check (ADR 0005) on the real sandbox image, in Docker: what a model leaves behind can't pass a game that
// doesn't run, and the main agent's tests decide a build. It needs the image, so it runs only
// with HOPON_BOX_IMAGE set, e.g. to one of `docker images cloudflare-dev/maker-box-*` after `pnpm -F worker dev:maker`.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buffer } from "node:stream/consumers";
import { after, before, test } from "node:test";

import { littlejsHtml } from "../image/page.ts";
import { boxPlaytest, checkBuild, restore, WORKSPACE } from "./job.ts";
import type { Box, Job, Tests } from "./job.ts";

const IMAGE = process.env.HOPON_BOX_IMAGE;
const skip = IMAGE ? false : "set HOPON_BOX_IMAGE to the sandbox image";
const USER = ["-u", "1001:1001", "-e", "HOME=/home/user"];

const docker = async (args: string[], input?: string) => {
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
// The sub agent's inputs: taps in the middle.
const INPUTS = JSON.stringify({
  inputs: [500, 1000, 1500, 2000].map((at) => ({
    at,
    type: "tap",
    x: 180,
    y: 320,
  })),
  ms: 3000,
});
const job: Job = {
  draftId: "check",
  revision: 0,
  source: {},
  spec: { brief: "", music: null, title: "Fruit" },
};

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
    await restore(box, { "game.ts": BROKEN });
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
      const verdict = await checkBuild(box, { job });

      assert.ok("errors" in verdict, JSON.stringify(verdict));
      assert.match(
        verdict.errors.join("\n"),
        /game\.ts changed while the harness ran it/u
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
  "a game that throws when it runs fails the check, with no test from the main agent",
  { skip, timeout: 300_000 },
  async () => {
    await restore(box, { "game.ts": BROKEN });

    const verdict = await checkBuild(box, { job });

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
    await restore(box, { "game.ts": GAME });

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
const tested = (tests: Tests): Job => ({
  ...job,
  spec: { ...job.spec, tests },
});

test(
  "the main agent's tests pass on a game that does what they check",
  { skip, timeout: 300_000 },
  async () => {
    await restore(box, { "game.ts": TESTED });

    const verdict = await checkBuild(box, {
      job: tested(swipeLeft("vars.basketX < prev.vars.basketX")),
    });

    assert.ok("files" in verdict, JSON.stringify(verdict));
  }
);

test(
  "a test the game doesn't meet fails the check, with what the game showed",
  { skip, timeout: 300_000 },
  async () => {
    await restore(box, { "game.ts": TESTED });

    const verdict = await checkBuild(box, {
      job: tested(swipeLeft("vars.basketX > prev.vars.basketX")),
    });

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
    await restore(box, { "game.ts": TESTED });

    const verdict = await checkBuild(box, {
      job: tested(swipeLeft("vars.basketX < prev.missing.basketX")),
    });

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
    await restore(box, { "game.ts": GAME });

    const verdict = await checkBuild(box, { job });

    assert.ok("files" in verdict, JSON.stringify(verdict));
    assert.equal(verdict.files["game.ts"], GAME);
    assert.equal(
      verdict.files["game.js"],
      await box.read(`${WORKSPACE}/game.js`)
    );
    assert.equal(verdict.files["index.html"], littlejsHtml(false));
    assert.deepEqual(verdict.deleted, []);
  }
);
