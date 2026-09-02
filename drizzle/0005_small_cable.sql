CREATE TABLE `upload_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`token_prefix` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_used_at` text,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_upload_tokens_hash` ON `upload_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_upload_tokens_member` ON `upload_tokens` (`member_id`);--> statement-breakpoint
CREATE INDEX `idx_upload_tokens_expiry` ON `upload_tokens` (`expires_at`);