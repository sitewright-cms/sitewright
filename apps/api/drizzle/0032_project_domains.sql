CREATE TABLE `project_domains` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`host` text NOT NULL,
	`is_primary` integer NOT NULL,
	`verification_token` text NOT NULL,
	`verified_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_domains_host_unique` ON `project_domains` (`host`);--> statement-breakpoint
CREATE INDEX `project_domains_project_idx` ON `project_domains` (`project_id`);