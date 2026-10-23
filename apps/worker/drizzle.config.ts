import { defineConfig } from "drizzle-kit";

// `out` is also wrangler's migrations_dir, and wrangler (not drizzle-kit migrate) applies it.
// Name each migration after its change, `pnpm db:generate --name reports`; without --name it gets a random one.
export default defineConfig({
  dialect: "sqlite",
  migrations: { prefix: "timestamp" },
  out: "./migrations",
  schema: "./src/schema.ts",
});
