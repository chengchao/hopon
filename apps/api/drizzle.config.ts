import { defineConfig } from "drizzle-kit";

// `out` is also wrangler's migrations_dir, and wrangler (not drizzle-kit migrate) applies it.
export default defineConfig({
  dialect: "sqlite",
  migrations: { prefix: "timestamp" },
  out: "./migrations",
  schema: "./src/schema.ts",
});
