CREATE TABLE `assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`reviewer_member_id` text NOT NULL,
	`assigned_by_member_id` text NOT NULL,
	`scope` text NOT NULL,
	`due_date` text,
	`status` text DEFAULT '待接受' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_assignments_project_reviewer` ON `assignments` (`project_id`,`reviewer_member_id`);--> statement-breakpoint
CREATE INDEX `idx_assignments_reviewer_status` ON `assignments` (`reviewer_member_id`,`status`);--> statement-breakpoint
CREATE TABLE `download_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`version_id` text NOT NULL,
	`member_id` text NOT NULL,
	`downloaded_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`version_id`) REFERENCES `project_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_download_logs_project_time` ON `download_logs` (`project_id`,`downloaded_at`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`site_user_id` text,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`research_field` text DEFAULT '待补充' NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_members_email` ON `members` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_members_site_user_id` ON `members` (`site_user_id`);--> statement-breakpoint
CREATE INDEX `idx_members_status` ON `members` (`status`);--> statement-breakpoint
CREATE TABLE `project_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`version_number` integer DEFAULT 1 NOT NULL,
	`file_name` text NOT NULL,
	`storage_key` text NOT NULL,
	`content_type` text DEFAULT 'application/octet-stream' NOT NULL,
	`size_bytes` integer NOT NULL,
	`uploaded_by_member_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_versions_project_number` ON `project_versions` (`project_id`,`version_number`);--> statement-breakpoint
CREATE INDEX `idx_versions_project_created` ON `project_versions` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`field` text NOT NULL,
	`owner_member_id` text NOT NULL,
	`status` text DEFAULT '待分配' NOT NULL,
	`review_scope` text NOT NULL,
	`ai_disclosure` text DEFAULT '未使用生成式 AI' NOT NULL,
	`visibility` text DEFAULT 'internal' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`owner_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_projects_field_status` ON `projects` (`field`,`status`);--> statement-breakpoint
CREATE INDEX `idx_projects_owner` ON `projects` (`owner_member_id`);--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`verdict` text NOT NULL,
	`correctness` text NOT NULL,
	`reproducibility` text NOT NULL,
	`data_and_ethics` text NOT NULL,
	`major_issues` text DEFAULT '' NOT NULL,
	`minor_issues` text DEFAULT '' NOT NULL,
	`summary` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reviews_assignment_id_unique` ON `reviews` (`assignment_id`);