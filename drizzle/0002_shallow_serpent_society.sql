DROP INDEX `idx_versions_project_number`;--> statement-breakpoint
ALTER TABLE `project_versions` ADD `artifact_kind` text DEFAULT 'description' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_versions_project_number_kind` ON `project_versions` (`project_id`,`version_number`,`artifact_kind`);