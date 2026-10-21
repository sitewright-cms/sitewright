-- SEARCH ENGINE ACCOUNTS — the one Google service account and the one Bing Webmaster Tools account the platform
-- registers its sites with, entered by an instance admin in System Settings. A new table only: the secret is
-- encrypted with SW_ENCRYPTION_KEY, and `info` holds only what the admin view may show (the key's email and project).
CREATE TABLE `webmaster_credentials` (
	`service` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`info` text NOT NULL,
	`updated_at` integer NOT NULL
);
