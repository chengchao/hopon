ALTER TABLE `games` ADD `author` text;--> statement-breakpoint
UPDATE games SET author = 'hopon' WHERE owner = 'hopon';
