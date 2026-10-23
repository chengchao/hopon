CREATE TABLE `comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` integer NOT NULL,
	`user` text NOT NULL,
	`author` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "comments_body" CHECK(length("comments"."body") BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE INDEX `comments_game` ON `comments` (`game_id`,"id" DESC);