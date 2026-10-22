-- SITE REMOVALS TO RETRY — a site the platform could not remove from its Google or Bing account when the project was
-- deleted, tried again from the hourly sweep with the account that registered it. No foreign key: it must outlive the
-- purge, which deletes the `webmaster_sites` row that was the only other record of the site. A new table only.
CREATE TABLE `webmaster_removals` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`service` text NOT NULL,
	`site_url` text NOT NULL,
	`account` text NOT NULL,
	`owners` text DEFAULT '[]' NOT NULL,
	`attempts` integer NOT NULL,
	`last_error` text,
	`next_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webmaster_removals_site` ON `webmaster_removals` (`service`,`site_url`,`account`);--> statement-breakpoint
CREATE INDEX `webmaster_removals_next` ON `webmaster_removals` (`next_at`);