CREATE TABLE `oauth_device_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_code` text NOT NULL,
	`client_id` text NOT NULL,
	`scope` text NOT NULL,
	`status` text NOT NULL,
	`user_id` text,
	`org_id` text,
	`project_id` text,
	`role` text,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`last_polled_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_device_codes_user_code_unique` ON `oauth_device_codes` (`user_code`);--> statement-breakpoint
CREATE INDEX `oauth_device_codes_expires_idx` ON `oauth_device_codes` (`expires_at`);