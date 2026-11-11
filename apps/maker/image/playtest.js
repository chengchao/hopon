// `node /opt/hopon/playtest.js ['<json>']` in the workspace, where json is {inputs, ms} or "random" for the eval's
// fixed 10 s script. Prints the result JSON and writes playtest-start.png and playtest-end.png. Exit 1 when red.
// `node /opt/hopon/playtest.js tests ['<json>']` runs the main agent's tests instead, from the JSON or ./tests.json.
import { readFileSync } from "node:fs";

import { playtest, randomScript, runTests } from "./helpers.js";

const [arg, suite] = process.argv.slice(2);
const result =
  arg === "tests"
    ? await runTests(JSON.parse(suite || readFileSync("tests.json", "utf-8")))
    : await playtest(
        arg === "random" ? randomScript() : JSON.parse(arg || "{}")
      );
console.log(JSON.stringify(result));
process.exitCode = result.ok ? 0 : 1;
