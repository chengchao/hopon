// Runs model-written code in the box: `node exec.js <file.mjs>` with cwd = the Draft's workspace.
// Puts the helpers on globalThis, then imports the file (an ES module, so top-level await works).
import { pathToFileURL } from "node:url";

import { minify, patch, playtest, read, write } from "./helpers.js";

Object.assign(globalThis, { minify, patch, playtest, read, write });
await import(pathToFileURL(process.argv[2]).href);
