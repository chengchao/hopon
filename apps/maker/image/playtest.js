// `node /opt/hopon/playtest.js ['<json>']` in the workspace, where json is {inputs, ms} or "random" for the eval's
// fixed 10 s script. Prints the result JSON and writes playtest-start.png and playtest-end.png. Exit 1 when red.
import { playtest, randomScript } from "./helpers.js";

const arg = process.argv.at(2);
const result = await playtest(
  arg === "random" ? randomScript() : JSON.parse(arg || "{}")
);
console.log(JSON.stringify(result));
process.exitCode = result.ok ? 0 : 1;
