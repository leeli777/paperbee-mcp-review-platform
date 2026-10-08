ALTER TABLE `projects` ADD `work_id` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `work_revision` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `version_label` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `revision_summary` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_projects_work_revision` ON `projects` (`work_id`,`work_revision`);