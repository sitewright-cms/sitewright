CREATE TABLE `form_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`form_id` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `form_submissions_project_created_idx` ON `form_submissions` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `form_submissions_project_form_idx` ON `form_submissions` (`project_id`,`form_id`);