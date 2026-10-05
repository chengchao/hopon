import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const games = sqliteTable(
  'games',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    owner: text('owner').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    html: text('html').notNull(),
    published: integer('published').notNull().default(0),
    // The creator's @handle when they published (Clerk username); null for drafts of users without one.
    author: text('author'),
    createdAt: text('created_at')
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index('games_feed').on(table.published, sql`${table.id} DESC`),
    check('games_title', sql`length(${table.title}) BETWEEN 1 AND 60`),
    check('games_description', sql`length(${table.description}) <= 180`),
    check('games_published', sql`${table.published} IN (0, 1)`),
  ],
);

export const generationLimits = sqliteTable('generation_limits', {
  bucket: text('bucket').primaryKey(),
  count: integer('count').notNull(),
});
