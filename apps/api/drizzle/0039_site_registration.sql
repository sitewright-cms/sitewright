-- SITE REGISTRATION — which of the platform's search engine accounts each project's site is registered with: whether
-- agency staff switched it on, the verification tag its builds carry, and how far the search engine got. A new table
-- only; reaped with its project.
CREATE TABLE `webmaster_sites` (
	`project_id` text NOT NULL,
	`service` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`site_url` text NOT NULL,
	`account` text NOT NULL,
	`token` text,
	`status` text NOT NULL,
	`detail` text,
	`verified_at` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `service`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
