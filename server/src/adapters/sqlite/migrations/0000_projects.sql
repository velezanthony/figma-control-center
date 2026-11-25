CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`project_dir` text NOT NULL,
	`file_url` text NOT NULL,
	`file_key` text NOT NULL,
	`scripts_roots` text,
	`output_dir` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_file_key` ON `projects` (`file_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_output_dir` ON `projects` (`output_dir`);