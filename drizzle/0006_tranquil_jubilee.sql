CREATE TABLE `ai_access_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`project_id` text,
	`version_id` text,
	`channel` text DEFAULT 'chatgpt_mcp' NOT NULL,
	`action` text NOT NULL,
	`material_kind` text,
	`outcome` text NOT NULL,
	`denial_reason` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`version_id`) REFERENCES `project_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_ai_access_logs_project_time` ON `ai_access_logs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ai_access_logs_member_time` ON `ai_access_logs` (`member_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `oauth_authorization_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`member_id` text NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`resource` text NOT NULL,
	`scope` text NOT NULL,
	`code_challenge` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_oauth_codes_hash` ON `oauth_authorization_codes` (`code_hash`);--> statement-breakpoint
CREATE INDEX `idx_oauth_codes_expiry` ON `oauth_authorization_codes` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_oauth_codes_client` ON `oauth_authorization_codes` (`client_id`);--> statement-breakpoint
CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`client_name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_oauth_clients_created` ON `oauth_clients` (`created_at`);--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
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
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_oauth_tokens_hash` ON `oauth_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_oauth_tokens_expiry` ON `oauth_tokens` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_oauth_tokens_member` ON `oauth_tokens` (`member_id`);--> statement-breakpoint
CREATE INDEX `idx_oauth_tokens_family` ON `oauth_tokens` (`family_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `public_code` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_projects_public_code` ON `projects` (`public_code`);