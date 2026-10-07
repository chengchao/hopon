CREATE TABLE `reports` (
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`description` text NOT NULL,
	`game_id` integer NOT NULL,
	`handle` text,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`creator` text NOT NULL,
	`reason` text NOT NULL,
	`reporter` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`title` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reports_reporter_game` ON `reports` (`reporter`,`game_id`);