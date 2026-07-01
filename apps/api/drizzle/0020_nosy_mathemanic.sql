ALTER TABLE `content` ADD `deleted_at` integer;--> statement-breakpoint
CREATE INDEX `content_deleted_idx` ON `content` (`project_id`,`kind`,`deleted_at`);