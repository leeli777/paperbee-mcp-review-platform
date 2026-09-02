CREATE TABLE `project_likes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`member_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_likes_project_member` ON `project_likes` (`project_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `idx_project_likes_project` ON `project_likes` (`project_id`);--> statement-breakpoint
CREATE TABLE `project_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`created_by_member_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_project_tags_project_normalized` ON `project_tags` (`project_id`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `idx_project_tags_project` ON `project_tags` (`project_id`);--> statement-breakpoint
CREATE TABLE `tag_likes` (
	`id` text PRIMARY KEY NOT NULL,
	`tag_id` text NOT NULL,
	`member_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tag_id`) REFERENCES `project_tags`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tag_likes_tag_member` ON `tag_likes` (`tag_id`,`member_id`);--> statement-breakpoint
CREATE INDEX `idx_tag_likes_tag` ON `tag_likes` (`tag_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `recommended_journals` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `ai_submission_advice` text DEFAULT '' NOT NULL;