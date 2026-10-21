ALTER TABLE `webmaster_sites` ADD `owners` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `webmaster_sites` ADD `sitemap_at` integer;--> statement-breakpoint
ALTER TABLE `webmaster_sites` ADD `sitemap_ok` integer;--> statement-breakpoint
ALTER TABLE `webmaster_sites` ADD `sitemap_detail` text;