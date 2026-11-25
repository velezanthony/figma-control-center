CREATE TABLE `cancel_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`job_id` text NOT NULL,
	`at` integer NOT NULL,
	`status` text NOT NULL,
	`handled_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cancel_job` ON `cancel_requests` (`job_id`);--> statement-breakpoint
CREATE INDEX `cancel_session_status` ON `cancel_requests` (`session_id`,`status`);