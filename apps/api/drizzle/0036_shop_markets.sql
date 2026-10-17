-- SHOP MARKETS — one sealed price list per market, and the market + ship-to country on each order.
--
-- `shop_catalog` gains `market` in its key: a shop with markets seals one list per market (each in its
-- market's currency); a shop without markets keeps its single list under market '' — the existing rows.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_shop_catalog` (
	`project_id` text NOT NULL,
	`mode` text NOT NULL,
	`market` text DEFAULT '' NOT NULL,
	`currency` text NOT NULL,
	`items` text NOT NULL,
	`digest` text NOT NULL,
	`published_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `mode`, `market`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_shop_catalog`("project_id", "mode", "market", "currency", "items", "digest", "published_at") SELECT "project_id", "mode", '', "currency", "items", "digest", "published_at" FROM `shop_catalog`;--> statement-breakpoint
DROP TABLE `shop_catalog`;--> statement-breakpoint
ALTER TABLE `__new_shop_catalog` RENAME TO `shop_catalog`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `shop_transactions` ADD `market` text;--> statement-breakpoint
ALTER TABLE `shop_transactions` ADD `ship_country` text;
