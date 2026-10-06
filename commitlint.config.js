export default {
  extends: ["@commitlint/config-conventional"],
  // git subtree writes its own "Squashed '<dir>/' content from commit <sha>" message.
  ignores: [(message) => message.startsWith("Squashed '")],
};
