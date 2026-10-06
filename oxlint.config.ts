import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";

export default defineConfig({
  extends: [core],
  ignorePatterns: [
    ...core.ignorePatterns,
    "**/worker-configuration.d.ts",
    "**/migrations/**",
    ".agents/**",
    ".claude/**",
    "repos/**",
  ],
  rules: {
    // Effect idioms: `Effect.gen(function* () {...})` bodies stay anonymous, and `Schema.TaggedError<T>()(...)` builds
    // an error class rather than throwing one.
    "func-names": ["error", "always", { generators: "never" }],
    "unicorn/throw-new-error": "off",
  },
});
