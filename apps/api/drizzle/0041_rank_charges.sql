-- RANK TRACKING MONEY — what each check cost, in a table of its own. The month's spend was the sum of `rank_checks`,
-- whose rows go with their keyword or project: removing keywords (or purging a project) made money already spent
-- vanish from the budget. Charges carry no foreign key, so they outlive the check, keyword and project.
--
-- Backfilled from every existing check, at the UTC month it was posted in — exactly what the budget counted before.
CREATE TABLE `rank_charges` (
	`check_id` text PRIMARY KEY NOT NULL,
	`month` text NOT NULL,
	`cost_micros` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rank_charges_month` ON `rank_charges` (`month`);--> statement-breakpoint
INSERT INTO `rank_charges` (`check_id`, `month`, `cost_micros`)
SELECT `id`, strftime('%Y-%m', `posted_at` / 1000, 'unixepoch'), `cost_micros` FROM `rank_checks`;
