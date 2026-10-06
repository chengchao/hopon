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
    // Effect idioms: `Effect.gen(function* () {...})` bodies stay anonymous, `Schema.TaggedError<T>()(...)` builds
    // an error class rather than throwing one, and services and errors are small classes that live side by side.
    "func-names": ["error", "always", { generators: "never" }],
    "max-classes-per-file": "off",
    "unicorn/throw-new-error": "off",
  },
});
