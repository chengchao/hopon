CREATE TABLE `drafts` (
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ')) NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `drafts_owner` ON `drafts` (`owner`,"updated_at" DESC);