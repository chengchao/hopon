import { defineConfig } from "oxlint";
import react from "ultracite/oxlint/react";

import root from "../../oxlint.config.ts";

// Oxlint lints each file with its nearest config alone, so this extends the
// root config and repeats the properties that extends doesn't carry over.
export default defineConfig({
  extends: [root, react],
  ignorePatterns: root.ignorePatterns,
  settings: root.settings,
});
