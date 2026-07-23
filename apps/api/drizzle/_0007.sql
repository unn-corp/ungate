-- Migration 0007: retain multiple OAuth accounts and mark one active per provider
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `__new_provider_settings` (
	`provider` text NOT NULL,
	`account_key` text NOT NULL,
	`is_active` integer NOT NULL DEFAULT 0,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`expires_at` integer,
	`email` text,
	`account_id` text,
	`created_at` integer NOT NULL,
	`base_url` text,
	PRIMARY KEY(`provider`, `account_key`)
);
--> statement-breakpoint
INSERT INTO `__new_provider_settings` (`provider`, `account_key`, `is_active`, `access_token`, `refresh_token`, `expires_at`, `email`, `account_id`, `created_at`, `base_url`)
SELECT `provider`, COALESCE(`account_id`, `email`, 'default'), 1, `access_token`, `refresh_token`, `expires_at`, `email`, `account_id`, `created_at`, `base_url` FROM `provider_settings`;
--> statement-breakpoint
DROP TABLE `provider_settings`;
--> statement-breakpoint
ALTER TABLE `__new_provider_settings` RENAME TO `provider_settings`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
