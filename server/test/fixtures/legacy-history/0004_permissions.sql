CREATE TABLE `permission_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`request_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`description` text NOT NULL,
	`input_preview` text NOT NULL,
	`at` integer NOT NULL,
	`status` text NOT NULL,
	`decided_at` integer,
	`decider_hash` text,
	`sent_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permission_session_request` ON `permission_requests` (`session_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `permission_session_id` ON `permission_requests` (`session_id`,`id`);