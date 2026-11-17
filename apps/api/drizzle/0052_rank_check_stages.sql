ALTER TABLE `rank_checks` ADD `cost_settled_micros` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Top 30 is no longer offered. A check now reads further pages only while the site has not turned up: a project
-- moved to Top 50 pays less than before for a site on the first two pages, and five pages instead of three when its
-- site is not found.
UPDATE `rank_projects` SET `depth` = 50 WHERE `depth` = 30;
