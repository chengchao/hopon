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
    // Music-source prototype (#129): vendored ZzFXM player, and model-written games, songs and synth scripts.
    "apps/maker/image/zzfxm.js",
    "apps/maker/music/games/**",
    "apps/maker/music/runs/**",
    "skills-lock.json",
  ],
});
