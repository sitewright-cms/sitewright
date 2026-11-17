ALTER TABLE `rank_checks` ADD `featured` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `rank_checks` ADD `results_read` integer;--> statement-breakpoint
ALTER TABLE `rank_checks` ADD `pages_read` integer;--> statement-breakpoint
ALTER TABLE `rank_checks` ADD `reread_at` integer;