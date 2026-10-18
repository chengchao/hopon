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
    // Music-source prototype (#129): vendored ZzFXM player, and model-written games, songs and synth scripts.
    "apps/maker/image/zzfxm.js",
    "apps/maker/music/games/**",
    "apps/maker/music/runs/**",
  ],
  rules: {
    // Effect idioms: `Effect.gen(function* () {...})` bodies stay anonymous, `Schema.TaggedError<T>()(...)` builds
    // an error class rather than throwing one, and services and errors are small classes that live side by side.
    "func-names": ["error", "always", { generators: "never" }],
    "max-classes-per-file": "off",
    "unicorn/throw-new-error": "off",
  },
});
