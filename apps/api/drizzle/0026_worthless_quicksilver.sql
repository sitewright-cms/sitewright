CREATE TABLE `project_releases` (
	`project_id` text PRIMARY KEY NOT NULL,
	`published_at` integer NOT NULL,
	`routes` integer DEFAULT 0 NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`page_failures` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
