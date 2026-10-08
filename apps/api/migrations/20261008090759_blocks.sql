CREATE TABLE `blocks` (
	`blocked` text NOT NULL,
	`blocker` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`handle` text,
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blocks_pair` ON `blocks` (`blocker`,`blocked`);--> statement-breakpoint
CREATE INDEX `blocks_blocked` ON `blocks` (`blocked`,`blocker`);