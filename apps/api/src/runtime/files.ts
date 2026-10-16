// PROTOTYPE: /runtime/v1.js is LittleJS (pinned in package.json) plus the scaffold, both imported as text
// (wrangler.jsonc `rules`); the fixture music is imported as bytes. index.ts imports this lazily, because Node,
// which runs test/worker.test.js, can't load these modules.
import engine from "littlejsengine/dist/littlejs.min.js";

import scaffold from "./scaffold.js";

export { default as FIXTURE_MUSIC } from "../../fixtures/music.mp3";
export const RUNTIME_V1 = `${engine}\n${scaffold}`;
