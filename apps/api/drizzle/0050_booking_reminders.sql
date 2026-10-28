-- BOOKING REMINDERS: the language a booking was made in (its later mails are in it), and when its reminder went out
-- (or was decided against). The reminder pass reads bookings not reminded yet, soonest first.
ALTER TABLE `booking_claims` ADD `locale` text;--> statement-breakpoint
ALTER TABLE `booking_claims` ADD `reminded_at` integer;--> statement-breakpoint
CREATE INDEX `booking_claims_remind` ON `booking_claims` (`reminded_at`,`start_at`);