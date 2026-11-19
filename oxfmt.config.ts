import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    ...ultracite.ignorePatterns,
    "**/worker-configuration.d.ts",
    "**/migrations/**",
    ".agents/**",
    ".claude/**",
    "repos/**",
    // Model-written games, frozen byte for byte as the eval's starting Revisions.
    "apps/maker/eval/revisions/**",
    // The same games as old Drafts, and their ports as the agent writes them.
    "apps/maker/fixtures/port/**",
    "skills-lock.json",
  ],
});
