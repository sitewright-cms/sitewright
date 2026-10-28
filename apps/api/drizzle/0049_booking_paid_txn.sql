-- BOOKING PREPAYMENT: the payment that confirmed a booking, set in the statement that books it, so of two payments for
-- one booking exactly one is kept (the other is refunded); and an accepted paid request's deadline to pay, which caps
-- how long a checkout begun close to it may keep the time.
ALTER TABLE `booking_claims` ADD `paid_txn_id` text;--> statement-breakpoint
ALTER TABLE `booking_claims` ADD `pay_by` integer;