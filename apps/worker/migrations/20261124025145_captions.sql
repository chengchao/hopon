-- A Game's `description` becomes its `caption`, and so does a report's snapshot of it. This is the expand half: both
-- columns stay, so the Worker serving while this applies, and every Preview on the staging D1, still reads and writes
-- `description`. A trigger on each table copies what such a Worker inserts into `caption`, and `games` copies back.
-- The contract half drops the two `description` columns and both triggers a deploy later, as `-- contract: #<this PR>`.
-- `games` is rebuilt as in games_are_files, not as drizzle-kit does it: `description` needs a default so a Worker can
-- insert without it, and losing the `games_description` CHECK lets a plain DROP COLUMN take it later. Captions are
-- copied as they are. No CASE: wrangler's statement splitter reads its END as a block's.
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__games` AS SELECT "author", "created_at", "description", "draft_id", "id", "owner", "runtime", "title" FROM `games`;--> statement-breakpoint
CREATE TABLE `__games_seq` AS SELECT "seq" FROM `sqlite_sequence` WHERE "name" = 'games';--> statement-breakpoint
DROP TABLE `games`;--> statement-breakpoint
CREATE TABLE `games` (
	`author` text,
	`caption` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`draft_id` text,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner` text NOT NULL,
	`runtime` text,
	`title` text NOT NULL,
	CONSTRAINT "games_title" CHECK(length("games"."title") BETWEEN 1 AND 60),
	CONSTRAINT "games_caption" CHECK(length("games"."caption") <= 180)
);
--> statement-breakpoint
INSERT INTO `games`("author", "caption", "created_at", "description", "draft_id", "id", "owner", "runtime", "title") SELECT "author", "description", "created_at", "description", "draft_id", "id", "owner", "runtime", "title" FROM `__games`;--> statement-breakpoint
INSERT INTO `sqlite_sequence`("name", "seq") SELECT 'games', "seq" FROM `__games_seq` WHERE NOT EXISTS (SELECT 1 FROM `sqlite_sequence` WHERE "name" = 'games');--> statement-breakpoint
UPDATE `sqlite_sequence` SET "seq" = max("seq", coalesce((SELECT "seq" FROM `__games_seq`), 0)) WHERE "name" = 'games';--> statement-breakpoint
DROP TABLE `__games`;--> statement-breakpoint
DROP TABLE `__games_seq`;--> statement-breakpoint
CREATE UNIQUE INDEX `games_draft_id_unique` ON `games` (`draft_id`);--> statement-breakpoint
CREATE TRIGGER `games_caption_mirror` AFTER INSERT ON `games` WHEN NEW."caption" = '' OR NEW."description" = '' BEGIN
	UPDATE `games` SET "caption" = iif(NEW."caption" = '', NEW."description", NEW."caption"), "description" = iif(NEW."description" = '', NEW."caption", NEW."description") WHERE "id" = NEW."id";
END;--> statement-breakpoint
ALTER TABLE `reports` ADD `caption` text;--> statement-breakpoint
UPDATE `reports` SET "caption" = "description";--> statement-breakpoint
CREATE TRIGGER `reports_caption` AFTER INSERT ON `reports` WHEN NEW."caption" IS NULL AND NEW."description" IS NOT NULL BEGIN
	UPDATE `reports` SET "caption" = NEW."description" WHERE "id" = NEW."id";
END;
