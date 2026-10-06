-- PAYMENTS — the tables behind processed shop payments.
--
-- `shop_catalog` is the AUTHORITATIVE PRICE LIST. The browser sends only {sku, qty}; the checkout
-- endpoint re-prices from this row. Cart `data-price` is author-facing display text and
-- client-tamperable by design, which is fine for an order inquiry and unusable as a charge amount.
-- One row per project per mode: `live` is written by a publish, `draft` by a preview build and is
-- usable only by a test-mode checkout, so an author can rehearse a real payment without publishing
-- and a preview can never transact against the live account.
--
-- `shop_stock` carries the OWNERSHIP SPLIT. `on_stock` is the quantity the author declared (the
-- opening balance, never decremented by a sale) and `authored_at_publish` records what they last
-- declared; `sold` is the platform's. A publish rewrites `on_stock` ONLY when the authored value
-- changed — otherwise the first unrelated republish silently restocks everything that had sold out.
-- `reserved` holds units during the redirect to the provider so two buyers cannot both be sold the
-- last one, and `reserved_until` lets an abandoned checkout be swept.
--
-- `shop_transactions` carries TWO INDEPENDENT notification state sets. The shop-admin notification
-- and the customer receipt fail independently: a bouncing merchant address must not block the
-- buyer's receipt, and retrying one must never re-send the other. `lines` is a FROZEN copy of the
-- priced order, because the catalog is replaced on every publish and an order must not be.
-- `public_token` is separate from `id` so a shared thank-you URL cannot be walked to enumerate
-- other people's orders.
--
-- `shop_payment_events` is replay defence (the `form_pow_spent` shape): providers retry a webhook
-- until they get a 2xx, and without this a replayed `paid` would re-notify, re-receipt and
-- re-commit stock. Keyed per gateway, because event ids are only unique within a provider.
--
-- `shop_filtered` counts checkouts the bot gates refused, per reason — the `form_filtered` shape,
-- for the same reason: a silent drop makes "we blocked 40 bots" and "we lost 40 sales"
-- indistinguishable.

CREATE TABLE `shop_catalog` (
	`project_id` text NOT NULL,
	`mode` text NOT NULL,
	`currency` text NOT NULL,
	`items` text NOT NULL,
	`digest` text NOT NULL,
	`published_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `mode`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shop_filtered` (
	`project_id` text NOT NULL,
	`channel_key` text NOT NULL,
	`reason` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`last_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `channel_key`, `reason`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shop_payment_events` (
	`gateway_id` text NOT NULL,
	`event_id` text NOT NULL,
	`seen_at` integer NOT NULL,
	PRIMARY KEY(`gateway_id`, `event_id`)
);
--> statement-breakpoint
CREATE INDEX `shop_payment_events_seen_idx` ON `shop_payment_events` (`seen_at`);--> statement-breakpoint
CREATE TABLE `shop_stock` (
	`project_id` text NOT NULL,
	`sku` text NOT NULL,
	`on_stock` integer,
	`sold` integer DEFAULT 0 NOT NULL,
	`reserved` integer DEFAULT 0 NOT NULL,
	`reserved_until` integer,
	`authored_at_publish` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `sku`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shop_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`channel_key` text NOT NULL,
	`gateway_id` text NOT NULL,
	`mode` text NOT NULL,
	`preview` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`fulfilment` text DEFAULT 'new' NOT NULL,
	`fulfilment_note` text,
	`currency` text NOT NULL,
	`subtotal_minor` integer NOT NULL,
	`shipping_minor` integer DEFAULT 0 NOT NULL,
	`tax_minor` integer DEFAULT 0 NOT NULL,
	`total_minor` integer NOT NULL,
	`refunded_minor` integer DEFAULT 0 NOT NULL,
	`lines` text NOT NULL,
	`buyer` text NOT NULL,
	`catalog_digest` text NOT NULL,
	`provider_ref` text,
	`provider_payment_ref` text,
	`public_token` text NOT NULL,
	`notify_state` text DEFAULT 'na' NOT NULL,
	`notify_attempts` integer DEFAULT 0 NOT NULL,
	`notify_next_at` integer,
	`notify_error` text,
	`notify_claimed_at` integer,
	`receipt_state` text DEFAULT 'na' NOT NULL,
	`receipt_attempts` integer DEFAULT 0 NOT NULL,
	`receipt_next_at` integer,
	`receipt_error` text,
	`receipt_claimed_at` integer,
	`customer_email` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`paid_at` integer,
	`expires_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shop_txn_public_token_idx` ON `shop_transactions` (`public_token`);--> statement-breakpoint
CREATE UNIQUE INDEX `shop_txn_provider_ref_idx` ON `shop_transactions` (`gateway_id`,`provider_ref`);--> statement-breakpoint
CREATE INDEX `shop_txn_project_created_idx` ON `shop_transactions` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `shop_txn_project_status_idx` ON `shop_transactions` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `shop_txn_notify_idx` ON `shop_transactions` (`notify_state`,`notify_next_at`);--> statement-breakpoint
CREATE INDEX `shop_txn_receipt_idx` ON `shop_transactions` (`receipt_state`,`receipt_next_at`);--> statement-breakpoint
CREATE INDEX `shop_txn_reconcile_idx` ON `shop_transactions` (`status`,`updated_at`);
