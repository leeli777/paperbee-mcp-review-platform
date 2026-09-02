DROP INDEX `idx_assignments_project_reviewer`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_assignments_project_active` ON `assignments` (`project_id`) WHERE "assignments"."status" IN ('待接受', '待审核');--> statement-breakpoint
CREATE INDEX `idx_assignments_project_reviewer` ON `assignments` (`project_id`,`reviewer_member_id`);