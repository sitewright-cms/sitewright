-- BOOKING CALENDAR WRITES: bookings put into (and taken out of) a CalDAV calendar that takes them. A switch, the
-- last write error and when it was last written on booking_calendars, and the bookings still to sync. See schema.ts.
CREATE TABLE `booking_calendar_writes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`seq` integer DEFAULT 1 NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_at` integer NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `booking_calendar_writes_target` ON `booking_calendar_writes` (`calendar_id`,`claim_id`);--> statement-breakpoint
CREATE INDEX `booking_calendar_writes_due` ON `booking_calendar_writes` (`state`,`next_at`);--> statement-breakpoint
ALTER TABLE `booking_calendars` ADD `writes` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `booking_calendars` ADD `write_error` text;--> statement-breakpoint
ALTER TABLE `booking_calendars` ADD `wrote_at` integer;