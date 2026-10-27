-- BOOKING CALENDARS: the outside calendars (iCalendar feeds) a resource's busy times are read from. The feed's
-- address is a credential and is stored encrypted (see the table's comment in schema.ts). A new table only.
CREATE TABLE `booking_calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`host` text NOT NULL,
	`last_ok_at` integer,
	`last_error` text,
	`last_events` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `booking_calendars_resource` ON `booking_calendars` (`project_id`,`resource_id`);