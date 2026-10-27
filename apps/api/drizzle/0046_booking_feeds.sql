-- BOOKING FEED: the business's bookings as an iCalendar feed its own calendar subscribes to. The address carries a
-- secret token, looked up by its hash and kept encrypted (see the table's comment in schema.ts). A new table only.
CREATE TABLE `booking_feeds` (
	`project_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_fetched_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_feeds_token_hash_unique` ON `booking_feeds` (`token_hash`);