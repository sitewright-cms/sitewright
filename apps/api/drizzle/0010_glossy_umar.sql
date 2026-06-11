CREATE TABLE `mfa_login_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `mfa_login_tickets_expires_idx` ON `mfa_login_tickets` (`expires_at`);--> statement-breakpoint
CREATE TABLE `user_mfa_recovery_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `user_mfa_recovery_user_idx` ON `user_mfa_recovery_codes` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_mfa_totp` (
	`user_id` text PRIMARY KEY NOT NULL,
	`secret` text,
	`pending_secret` text,
	`last_used_step` integer,
	`confirmed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
