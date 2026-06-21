CREATE TABLE `content_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`data` text NOT NULL,
	`op` text NOT NULL,
	`user_id` text NOT NULL,
	`actor` text NOT NULL,
	`note` text,
	`revision_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `content_rev_entity_idx` ON `content_revisions` (`project_id`,`kind`,`entity_id`,`revision_at`);