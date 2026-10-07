PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_reports` (
	`body` text,
	`comment_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`creator` text NOT NULL,
	`description` text,
	`game_id` integer NOT NULL,
	`handle` text,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reason` text NOT NULL,
	`reporter` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`title` text
);
--> statement-breakpoint
INSERT INTO `__new_reports`("body", "comment_id", "created_at", "creator", "description", "game_id", "handle", "id", "reason", "reporter", "status", "title") SELECT NULL, NULL, "created_at", "creator", "description", "game_id", "handle", "id", "reason", "reporter", "status", "title" FROM `reports`;--> statement-breakpoint
DROP TABLE `reports`;--> statement-breakpoint
ALTER TABLE `__new_reports` RENAME TO `reports`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `reports_reporter_game` ON `reports` (`reporter`,`game_id`) WHERE "reports"."comment_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `reports_reporter_comment` ON `reports` (`reporter`,`comment_id`) WHERE "reports"."comment_id" IS NOT NULL;