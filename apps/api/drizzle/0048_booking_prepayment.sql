-- BOOKING PREPAYMENT: a shop transaction can pay for a booking (its claim), settling the booking rather than stock.
-- It keeps the booking's facts for its mails once the claim is gone, and when it was settled (a paid booking
-- transaction never settled is one a crash lost; the maintenance sweep finishes it).
ALTER TABLE `shop_transactions` ADD `booking_claim_id` text;--> statement-breakpoint
ALTER TABLE `shop_transactions` ADD `booking_snapshot` text;--> statement-breakpoint
ALTER TABLE `shop_transactions` ADD `booking_settled_at` integer;--> statement-breakpoint
CREATE INDEX `shop_txn_booking_claim_idx` ON `shop_transactions` (`booking_claim_id`);--> statement-breakpoint
CREATE INDEX `shop_txn_booking_unsettled_idx` ON `shop_transactions` (`booking_settled_at`,`booking_claim_id`);