import { defineConfig } from 'drizzle-kit';

// `out` is also wrangler's migrations_dir, and wrangler (not drizzle-kit migrate) applies it.
export default defineConfig({
  dialect: 'sqlite',
  schema: './worker/schema.ts',
  out: './migrations',
  migrations: { prefix: 'timestamp' },
});
