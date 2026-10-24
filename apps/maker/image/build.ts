// pnpm -F maker template [eval]: builds the E2B template the Coder's box runs (node, a warm Chromium, ffmpeg,
// typescript, /opt/hopon/*), per #113 and #115: the production one, or with `eval` the eval's, so a sweep never
// changes what the Container's boxes run.
import { defaultBuildLogger, Template, waitForPort } from "e2b";

import { E2B_TEMPLATE, EVAL_TEMPLATE } from "../src/box.ts";
import { buildRuntime } from "../src/runtime.ts";

console.log("runtime", await buildRuntime());

const template = Template({ fileContextPath: import.meta.dirname })
  .fromNodeImage("24")
  .setUser("root")
  .aptInstall(["ffmpeg"])
  .setEnvs({ PLAYWRIGHT_BROWSERS_PATH: "/opt/hopon/browsers" })
  .runCmd([
    "mkdir -p /opt/hopon /workspace",
    "cd /opt/hopon && npm init -y >/dev/null && npm pkg set type=module && npm install esbuild@0.28.2 playwright-core@1.58.2 typescript@6.0.3",
    "cd /opt/hopon && npx playwright-core install --with-deps chromium-headless-shell",
  ])
  .copy(
    [
      "browser.js",
      "dom.d.ts",
      "dom.js",
      "helpers.js",
      "littlejs.d.ts",
      "page.ts",
      "playtest.js",
      "runtime.js",
    ],
    "/opt/hopon/"
  )
  .runCmd("chown -R user:user /workspace")
  .setUser("user")
  .setWorkdir("/workspace")
  .setStartCmd("node /opt/hopon/browser.js", waitForPort(9222));

console.log(
  await Template.build(
    template,
    process.argv[2] === "eval" ? EVAL_TEMPLATE : E2B_TEMPLATE,
    {
      cpuCount: 2,
      memoryMB: 2048,
      onBuildLogs: defaultBuildLogger(),
    }
  )
);
