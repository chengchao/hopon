-- Games are files (#145): a published Game's HTML moves to R2 `games/<id>/index.html`, and `games` keeps only published
-- Games. One-way: run `pnpm -F worker games-to-r2 --remote` (scripts/games-to-r2.mjs) BEFORE this migration reaches
-- remote D1, or the HTML is gone. The copy leaves out unpublished rows, which deletes them (hopon hasn't launched).
-- Not drizzle-kit's rebuild: D1 ignores foreign_keys=OFF, and renaming a new table into place leaves the deferred
-- violations from dropping `games` (which likes, comments and saves point at) counted. Re-inserting the rows into a
-- table named `games` clears them. The id sequence is kept, so no new Game takes a deleted one's id, which its reports
-- still name. No CASE: wrangler's statement splitter reads its END as a block's. Bubble Pop moves from the runtime's v1
-- to v2 (games-to-r2 rewrites its page), since v1 is no longer served.
ALTER TABLE `drafts` ADD `description` text;--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__games` AS SELECT "author", "created_at", "description", "id", "owner", iif("html" LIKE '%/runtime/v1.js%', 'v2', NULL) AS "runtime", "title" FROM `games` WHERE "published" = 1;--> statement-breakpoint
CREATE TABLE `__games_seq` AS SELECT "seq" FROM `sqlite_sequence` WHERE "name" = 'games';--> statement-breakpoint
DROP TABLE `games`;--> statement-breakpoint
CREATE TABLE `games` (
	`author` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`description` text NOT NULL,
	`draft_id` text,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner` text NOT NULL,
	`runtime` text,
	`title` text NOT NULL,
	CONSTRAINT "games_title" CHECK(length("games"."title") BETWEEN 1 AND 60),
	CONSTRAINT "games_description" CHECK(length("games"."description") <= 180)
);
--> statement-breakpoint
INSERT INTO `games`("author", "created_at", "description", "id", "owner", "runtime", "title") SELECT "author", "created_at", "description", "id", "owner", "runtime", "title" FROM `__games`;--> statement-breakpoint
INSERT INTO `sqlite_sequence`("name", "seq") SELECT 'games', "seq" FROM `__games_seq` WHERE NOT EXISTS (SELECT 1 FROM `sqlite_sequence` WHERE "name" = 'games');--> statement-breakpoint
UPDATE `sqlite_sequence` SET "seq" = max("seq", coalesce((SELECT "seq" FROM `__games_seq`), 0)) WHERE "name" = 'games';--> statement-breakpoint
DROP TABLE `__games`;--> statement-breakpoint
DROP TABLE `__games_seq`;--> statement-breakpoint
CREATE UNIQUE INDEX `games_draft_id_unique` ON `games` (`draft_id`);
