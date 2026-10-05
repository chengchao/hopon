import { defineConfig } from 'drizzle-kit';

// `out` is also wrangler's migrations_dir. Timestamp prefixes sort after the hand-written 0001_games.sql.
export default defineConfig({
  dialect: 'sqlite',
  schema: './worker/schema.ts',
  out: './migrations',
  migrations: { prefix: 'timestamp' },
});
