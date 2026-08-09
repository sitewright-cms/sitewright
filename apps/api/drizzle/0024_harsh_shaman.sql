CREATE TABLE `form_filtered` (
	`project_id` text NOT NULL,
	`form_id` text NOT NULL,
	`reason` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`last_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `form_id`, `reason`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
