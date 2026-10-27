-- BOOKING MAILS on their way: confirmations, requests and cancellations, rendered when the booking happened. A row
-- is deleted once sent; a failing one backs off and is kept as `failed` for a week (see the table's comment in
-- schema.ts). A new table only.
CREATE TABLE `booking_mails` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`recipient` text NOT NULL,
	`subject` text NOT NULL,
	`reply_to` text,
	`body` text NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_at` integer NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `booking_mails_due` ON `booking_mails` (`state`,`next_at`);--> statement-breakpoint
CREATE INDEX `booking_mails_project` ON `booking_mails` (`project_id`);