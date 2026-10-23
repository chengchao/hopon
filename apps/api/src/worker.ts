// wrangler's entry: the Worker and the Talker. Tests import index.ts in Node, where the Talker's packages can't load.
export { default } from "./index.ts";
export { Talker } from "./talker.ts";
