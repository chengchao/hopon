-- contract: #240 stopped reading `games.description` and `reports.description`: a Caption is `caption` alone.
-- Its Worker's INSERTs still name both columns, as drizzle lists every column of the table, so Publish and Report
-- fail from this migration until the Worker that ships with it is serving. hopon has no users yet; the owner took that.
-- The triggers go first: SQLite refuses to drop a column a trigger names.
DROP TRIGGER `games_caption_mirror`;--> statement-breakpoint
DROP TRIGGER `reports_caption`;--> statement-breakpoint
ALTER TABLE `games` DROP COLUMN `description`;--> statement-breakpoint
ALTER TABLE `reports` DROP COLUMN `description`;
