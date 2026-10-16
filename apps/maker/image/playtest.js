// `node playtest.js [ms]` in the workspace: plays game.ts in headless Chromium, prints the result JSON, writes
// playtest.png. Exit 1 when the game is not ok, so a bash tool result reads as an error.
import { playtest } from "./helpers.js";

const result = await playtest({ ms: Number(process.argv[2]) || undefined });
process.exitCode = result.ok ? 0 : 1;
