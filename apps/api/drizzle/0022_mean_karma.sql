ALTER TABLE `form_submissions` ADD `delivery_state` text DEFAULT 'na' NOT NULL;--> statement-breakpoint
ALTER TABLE `form_submissions` ADD `delivery_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `form_submissions` ADD `delivery_next_at` integer;--> statement-breakpoint
ALTER TABLE `form_submissions` ADD `delivery_error` text;--> statement-breakpoint
CREATE INDEX `form_submissions_delivery_idx` ON `form_submissions` (`delivery_state`,`delivery_next_at`);