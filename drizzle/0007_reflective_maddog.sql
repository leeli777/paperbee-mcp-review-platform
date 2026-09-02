CREATE TABLE `oauth_rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_oauth_rate_limits_expiry` ON `oauth_rate_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `oauth_token_families` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`client_id` text NOT NULL,
	`credential_version` integer NOT NULL,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_oauth_families_member` ON `oauth_token_families` (`member_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_families_client` ON `oauth_token_families` (`client_id`);--> statement-breakpoint
ALTER TABLE `ai_access_logs` ADD `project_code_snapshot` text;--> statement-breakpoint
ALTER TABLE `ai_access_logs` ADD `project_title_snapshot` text;--> statement-breakpoint
ALTER TABLE `ai_access_logs` ADD `file_name_snapshot` text;--> statement-breakpoint
ALTER TABLE `members` ADD `oauth_credential_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `oauth_authorization_codes` ADD `credential_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
INSERT INTO `oauth_token_families` (`id`, `member_id`, `client_id`, `credential_version`, `revoked_at`, `created_at`)
SELECT `family_id`, `member_id`, `client_id`, 0, max(`revoked_at`), min(`created_at`)
FROM `oauth_tokens`
GROUP BY `family_id`, `member_id`, `client_id`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_oauth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_type` text NOT NULL,
	`member_id` text NOT NULL,
	`client_id` text NOT NULL,
	`resource` text NOT NULL,
	`scope` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`revoked_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`family_id`) REFERENCES `oauth_token_families`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_oauth_tokens`("id", "family_id", "token_hash", "token_type", "member_id", "client_id", "resource", "scope", "expires_at", "consumed_at", "revoked_at", "created_at") SELECT "id", "family_id", "token_hash", "token_type", "member_id", "client_id", "resource", "scope", "expires_at", "consumed_at", "revoked_at", "created_at" FROM `oauth_tokens`;--> statement-breakpoint
DROP TABLE `oauth_tokens`;--> statement-breakpoint
ALTER TABLE `__new_oauth_tokens` RENAME TO `oauth_tokens`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_oauth_tokens_hash` ON `oauth_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_oauth_tokens_expiry` ON `oauth_tokens` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_oauth_tokens_member` ON `oauth_tokens` (`member_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_tokens_family` ON `oauth_tokens` (`family_id`);
