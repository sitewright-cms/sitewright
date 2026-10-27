-- BOOKING CLAIMS — the little the platform itself keeps about bookings: short holds while a booking is written or paid,
-- requests waiting for the owner, and bookings on resources with no calendar it can write to. Every row ends (see the
-- table's comment in schema.ts). A new table only.
CREATE TABLE `booking_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`offering_id` text NOT NULL,
	`state` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`busy_start` integer NOT NULL,
	`busy_end` integer NOT NULL,
	`units` integer NOT NULL,
	`exclusive` integer DEFAULT false NOT NULL,
	`expires_at` integer,
	`customer` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `booking_claims_resource` ON `booking_claims` (`project_id`,`resource_id`,`busy_start`);--> statement-breakpoint
CREATE INDEX `booking_claims_expires` ON `booking_claims` (`expires_at`);--> statement-breakpoint
CREATE INDEX `booking_claims_end` ON `booking_claims` (`busy_end`);