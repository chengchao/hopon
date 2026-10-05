CREATE TABLE `games` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`html` text NOT NULL,
	`published` integer DEFAULT 0 NOT NULL,
	`author` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "games_title" CHECK(length("games"."title") BETWEEN 1 AND 60),
	CONSTRAINT "games_description" CHECK(length("games"."description") <= 180),
	CONSTRAINT "games_published" CHECK("games"."published" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `games_feed` ON `games` (`published`,"id" DESC);--> statement-breakpoint
CREATE TABLE `generation_limits` (
	`bucket` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `likes` (
	`game_id` integer NOT NULL,
	`user` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`game_id`, `user`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `likes_user` ON `likes` (`user`);