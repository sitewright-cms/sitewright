ALTER TABLE `mfa_login_tickets` ADD `via_sso` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `password_expires_at` integer;