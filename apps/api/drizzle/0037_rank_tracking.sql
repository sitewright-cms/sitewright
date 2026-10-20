-- KEYWORD RANK TRACKING — where a project's site ranks in search results for keywords the agency chose.
--
-- New tables only: the instance's provider + monthly budget, each provider's encrypted credentials, each project's
-- tracking setup and keywords, and one row per keyword per day for every check (claimed before the provider is
-- called, with its estimated cost booked at once, so a keyword is sent at most once a day and the budget never
-- misses a charge).
CREATE TABLE `rank_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`keyword_id` text NOT NULL,
	`project_id` text NOT NULL,
	`day` text NOT NULL,
	`provider` text NOT NULL,
	`provider_ref` text,
	`status` text NOT NULL,
	`domain` text NOT NULL,
	`include_subdomains` integer NOT NULL,
	`depth` integer NOT NULL,
	`position` integer,
	`absolute_position` integer,
	`url` text,
	`cost_micros` integer DEFAULT 0 NOT NULL,
	`error` text,
	`posted_at` integer NOT NULL,
	`checked_at` integer,
	FOREIGN KEY (`keyword_id`) REFERENCES `rank_keywords`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rank_checks_keyword_day` ON `rank_checks` (`keyword_id`,`day`);--> statement-breakpoint
CREATE INDEX `rank_checks_status` ON `rank_checks` (`status`);--> statement-breakpoint
CREATE INDEX `rank_checks_project_day` ON `rank_checks` (`project_id`,`day`);--> statement-breakpoint
CREATE INDEX `rank_checks_posted` ON `rank_checks` (`posted_at`);--> statement-breakpoint
CREATE TABLE `rank_keywords` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`keyword` text NOT NULL,
	`engine` text NOT NULL,
	`device` text NOT NULL,
	`location_name` text NOT NULL,
	`country_code` text NOT NULL,
	`language_code` text NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rank_keywords_unique` ON `rank_keywords` (`project_id`,`keyword`,`engine`,`device`,`location_name`,`language_code`);--> statement-breakpoint
CREATE INDEX `rank_keywords_project` ON `rank_keywords` (`project_id`);--> statement-breakpoint
CREATE TABLE `rank_projects` (
	`project_id` text PRIMARY KEY NOT NULL,
	`domain` text NOT NULL,
	`include_subdomains` integer NOT NULL,
	`schedule` text NOT NULL,
	`depth` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rank_provider_credentials` (
	`provider` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rank_tracking_config` (
	`id` text PRIMARY KEY NOT NULL,
	`active_provider` text,
	`monthly_budget_micros` integer NOT NULL,
	`last_error` text,
	`last_error_at` integer,
	`updated_at` integer NOT NULL
);
