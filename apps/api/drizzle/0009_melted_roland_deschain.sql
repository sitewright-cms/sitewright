UPDATE `api_keys` SET `role` = 'owner' WHERE `role` = 'admin';--> statement-breakpoint
UPDATE `oauth_auth_codes` SET `role` = 'owner' WHERE `role` = 'admin';--> statement-breakpoint
UPDATE `oauth_refresh_tokens` SET `role` = 'owner' WHERE `role` = 'admin';--> statement-breakpoint
UPDATE `oauth_device_codes` SET `role` = 'owner' WHERE `role` = 'admin';--> statement-breakpoint
DROP TABLE `memberships`;--> statement-breakpoint
DROP TABLE `organizations`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text,
	`model` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_ai_usage`("id", "user_id", "project_id", "model", "input_tokens", "output_tokens", "created_at") SELECT "id", "user_id", "project_id", "model", "input_tokens", "output_tokens", "created_at" FROM `ai_usage`;--> statement-breakpoint
DROP TABLE `ai_usage`;--> statement-breakpoint
ALTER TABLE `__new_ai_usage` RENAME TO `ai_usage`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ai_usage_user_created_idx` ON `ai_usage` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`capabilities` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`last_used_at` integer,
	`created_by` text NOT NULL,
	`source` text DEFAULT 'pat' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_api_keys`("id", "project_id", "name", "role", "capabilities", "token_hash", "token_prefix", "expires_at", "revoked_at", "last_used_at", "created_by", "source", "created_at") SELECT "id", "project_id", "name", "role", "capabilities", "token_hash", "token_prefix", "expires_at", "revoked_at", "last_used_at", "created_by", "source", "created_at" FROM `api_keys`;--> statement-breakpoint
DROP TABLE `api_keys`;--> statement-breakpoint
ALTER TABLE `__new_api_keys` RENAME TO `api_keys`;--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_token_hash_unique` ON `api_keys` (`token_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_project_idx` ON `api_keys` (`project_id`);--> statement-breakpoint
CREATE TABLE `__new_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL,
	`invited_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`accepted_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_invites`("id", "project_id", "email", "role", "token_hash", "invited_by", "expires_at", "accepted_at", "accepted_by", "created_at") SELECT "id", "project_id", "email", "role", "token_hash", "invited_by", "expires_at", "accepted_at", "accepted_by", "created_at" FROM `invites`;--> statement-breakpoint
DROP TABLE `invites`;--> statement-breakpoint
ALTER TABLE `__new_invites` RENAME TO `invites`;--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_hash_unique` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE INDEX `invites_project_idx` ON `invites` (`project_id`);--> statement-breakpoint
CREATE TABLE `__new_oauth_auth_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`role` text NOT NULL,
	`scope` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_oauth_auth_codes`("id", "client_id", "user_id", "project_id", "role", "scope", "redirect_uri", "code_challenge", "expires_at", "consumed_at", "created_at") SELECT "id", "client_id", "user_id", "project_id", "role", "scope", "redirect_uri", "code_challenge", "expires_at", "consumed_at", "created_at" FROM `oauth_auth_codes`;--> statement-breakpoint
DROP TABLE `oauth_auth_codes`;--> statement-breakpoint
ALTER TABLE `__new_oauth_auth_codes` RENAME TO `oauth_auth_codes`;--> statement-breakpoint
CREATE INDEX `oauth_auth_codes_expires_idx` ON `oauth_auth_codes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `__new_oauth_refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`project_id` text NOT NULL,
	`role` text NOT NULL,
	`scope` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`rotated_to` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_oauth_refresh_tokens`("id", "client_id", "user_id", "project_id", "role", "scope", "expires_at", "revoked_at", "rotated_to", "created_at") SELECT "id", "client_id", "user_id", "project_id", "role", "scope", "expires_at", "revoked_at", "rotated_to", "created_at" FROM `oauth_refresh_tokens`;--> statement-breakpoint
DROP TABLE `oauth_refresh_tokens`;--> statement-breakpoint
ALTER TABLE `__new_oauth_refresh_tokens` RENAME TO `oauth_refresh_tokens`;--> statement-breakpoint
CREATE INDEX `oauth_refresh_expires_idx` ON `oauth_refresh_tokens` (`expires_at`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_user_project_idx` ON `oauth_refresh_tokens` (`user_id`,`project_id`);--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_projects`("id", "name", "slug", "created_at") SELECT "id", "name", "slug", "created_at" FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
ALTER TABLE `users` ADD `platform_role` text;--> statement-breakpoint
ALTER TABLE `oauth_device_codes` DROP COLUMN `org_id`;