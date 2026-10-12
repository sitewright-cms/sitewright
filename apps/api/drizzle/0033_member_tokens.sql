CREATE TABLE `member_token_creations` (
	`id` text PRIMARY KEY NOT NULL,
	`token_id` text NOT NULL,
	`project_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`token_id`) REFERENCES `member_tokens`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `member_token_creations_token_idx` ON `member_token_creations` (`token_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `member_token_projects` (
	`token_id` text NOT NULL,
	`project_id` text NOT NULL,
	`first_used_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	PRIMARY KEY(`token_id`, `project_id`),
	FOREIGN KEY (`token_id`) REFERENCES `member_tokens`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `member_token_projects_project_idx` ON `member_token_projects` (`project_id`);--> statement-breakpoint
CREATE TABLE `member_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`capabilities` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_tokens_token_hash_unique` ON `member_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `member_tokens_user_idx` ON `member_tokens` (`user_id`);