// pnpm -F maker template: builds the hopon-maker E2B template (node, chromium, ffmpeg, /opt/hopon/{exec,runtime}.js).
import { defaultBuildLogger, Template } from "e2b";

import { E2B_TEMPLATE } from "../src/box.ts";
import { buildRuntime } from "../src/runtime.ts";

console.log("runtime", await buildRuntime());

const template = Template({ fileContextPath: import.meta.dirname })
  .fromNodeImage("24")
  .setUser("root")
  .aptInstall(["ffmpeg"])
  .setEnvs({ PLAYWRIGHT_BROWSERS_PATH: "/opt/hopon/browsers" })
  .runCmd([
    "mkdir -p /opt/hopon /workspace",
    "cd /opt/hopon && npm init -y >/dev/null && npm pkg set type=module && npm install esbuild@0.28.2 playwright-core@1.58.2",
    "cd /opt/hopon && npx playwright-core install --with-deps chromium-headless-shell",
  ])
  .copy(["exec.js", "helpers.js", "playtest.js", "runtime.js"], "/opt/hopon/")
  .runCmd("chown -R user:user /workspace")
  .setUser("user")
  .setWorkdir("/workspace");

console.log(
  await Template.build(template, E2B_TEMPLATE, {
    cpuCount: 2,
    memoryMB: 2048,
    onBuildLogs: defaultBuildLogger(),
  })
);
