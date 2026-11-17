ALTER TABLE `rank_checks` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rank_checks` ADD `retry_at` integer;--> statement-breakpoint
ALTER TABLE `rank_checks` ADD `confirming` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `rank_checks_day_provider` ON `rank_checks` (`day`,`provider`);