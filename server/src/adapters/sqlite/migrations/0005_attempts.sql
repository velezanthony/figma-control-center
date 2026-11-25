CREATE TABLE `attempt_scripts` (
	`project_id` integer NOT NULL,
	`attempt_id` integer NOT NULL,
	`role` text NOT NULL,
	`path` text DEFAULT '' NOT NULL,
	`sha256` text NOT NULL,
	PRIMARY KEY(`project_id`, `attempt_id`, `role`, `path`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attempt_scripts_project_sha` ON `attempt_scripts` (`project_id`,`sha256`);--> statement-breakpoint
CREATE TABLE `attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`n` integer NOT NULL,
	`call_id` text,
	`job_id` text,
	`step_index` integer,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL,
	`status` text NOT NULL,
	`first_error` text,
	`kit` text NOT NULL,
	`kit_sha256` text NOT NULL,
	`assets_json` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attempts_project_target_n` ON `attempts` (`project_id`,`kind`,`target`,`n`);--> statement-breakpoint
CREATE INDEX `attempts_project_call` ON `attempts` (`project_id`,`call_id`);--> statement-breakpoint
CREATE INDEX `attempts_project_started` ON `attempts` (`project_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `script_blobs` (
	`project_id` integer NOT NULL,
	`sha256` text NOT NULL,
	`kind` text NOT NULL,
	`bytes` integer NOT NULL,
	`stored` text NOT NULL,
	`content` blob,
	`first_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `sha256`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
