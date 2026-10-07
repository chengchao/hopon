import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const games = sqliteTable(
  "games",
  {
    // The creator's @handle when they published (Clerk username); null for drafts of users without one.
    author: text("author"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    description: text("description").notNull(),
    html: text("html").notNull(),
    id: integer("id").primaryKey({ autoIncrement: true }),
    owner: text("owner").notNull(),
    published: integer("published").notNull().default(0),
    title: text("title").notNull(),
  },
  (table) => [
    index("games_feed").on(table.published, sql`${table.id} DESC`),
    check("games_title", sql`length(${table.title}) BETWEEN 1 AND 60`),
    check("games_description", sql`length(${table.description}) <= 180`),
    check("games_published", sql`${table.published} IN (0, 1)`),
  ]
);

export const generationLimits = sqliteTable("generation_limits", {
  bucket: text("bucket").primaryKey(),
  count: integer("count").notNull(),
});

// One row per (game, Clerk user). The primary key also serves the per-game counts; likes_user serves "my likes".
export const likes = sqliteTable(
  "likes",
  {
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    // No cascade: SQLite table rebuilds drop and recreate `games`, which would cascade-delete every like.
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id),
    user: text("user").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.user] }),
    index("likes_user").on(table.user),
  ]
);

// A flat list per published game. `author` is the commenter's @handle when they posted, like `games.author`.
export const comments = sqliteTable(
  "comments",
  {
    author: text("author").notNull(),
    body: text("body").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    // No cascade, for the same reason as `likes`.
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id),
    id: integer("id").primaryKey({ autoIncrement: true }),
    user: text("user").notNull(),
  },
  (table) => [
    index("comments_game").on(table.gameId, sql`${table.id} DESC`),
    check("comments_body", sql`length(${table.body}) BETWEEN 1 AND 300`),
  ]
);

// One row per (Clerk user, published game), private to that user. `id` is the paging cursor for "newest save first".
export const saves = sqliteTable(
  "saves",
  {
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    // No cascade, for the same reason as `likes`.
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id),
    id: integer("id").primaryKey({ autoIncrement: true }),
    user: text("user").notNull(),
  },
  // The unique index is ordered by game, so paging "my saves" by id needs its own.
  (table) => [
    uniqueIndex("saves_user_game").on(table.user, table.gameId),
    index("saves_user").on(table.user, sql`${table.id} DESC`),
  ]
);

// A Report on a published game, for the Operator: a snapshot of what was reported (no HTML), so it outlives the game.
// No FK to `games` for that reason. `creator` and `handle` are the creator's account id and @handle; `reporter` is an account id.
export const reports = sqliteTable(
  "reports",
  {
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    creator: text("creator").notNull(),
    description: text("description").notNull(),
    gameId: integer("game_id").notNull(),
    handle: text("handle"),
    id: integer("id").primaryKey({ autoIncrement: true }),
    reason: text("reason").notNull(),
    reporter: text("reporter").notNull(),
    // `open` until the Operator closes it.
    status: text("status").notNull().default("open"),
    title: text("title").notNull(),
  },
  // Also serves the per-viewer filter on feeds.
  (table) => [
    uniqueIndex("reports_reporter_game").on(table.reporter, table.gameId),
  ]
);
