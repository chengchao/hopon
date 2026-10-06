CREATE TABLE `saves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`user` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saves_user_game` ON `saves` (`user`,`game_id`);--> statement-breakpoint
CREATE INDEX `saves_user` ON `saves` (`user`,"id" DESC);