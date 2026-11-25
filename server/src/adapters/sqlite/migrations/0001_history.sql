CREATE TABLE `build_steps` (
	`project_id` integer NOT NULL,
	`job_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`file` text NOT NULL,
	`status` text NOT NULL,
	`ms` integer,
	`touched_count` integer DEFAULT 0 NOT NULL,
	`error_type` text,
	`error_message` text,
	`next_step` text,
	`error_line` integer,
	`warning` text,
	`result_json` text,
	`result_path` text,
	`result_bytes` integer,
	PRIMARY KEY(`project_id`, `job_id`, `step_index`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `call_nodes` (
	`project_id` integer NOT NULL,
	`call_id` text NOT NULL,
	`node_id` text NOT NULL,
	PRIMARY KEY(`project_id`, `call_id`, `node_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`call_id`) REFERENCES `calls`(`project_id`,`call_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `call_nodes_project_node` ON `call_nodes` (`project_id`,`node_id`);--> statement-breakpoint
CREATE TABLE `calls` (
	`project_id` integer NOT NULL,
	`call_id` text NOT NULL,
	`session_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`tool` text NOT NULL,
	`status` text NOT NULL,
	`ms` integer,
	`is_write` integer NOT NULL,
	`error_type` text,
	`error_message` text,
	`next_step` text,
	`error_line` integer,
	`retryable` integer,
	`job_id` text,
	`starts_job` integer DEFAULT false NOT NULL,
	`args_summary` text NOT NULL,
	`result_path` text,
	`summary` text NOT NULL,
	`touched_count` integer DEFAULT 0 NOT NULL,
	`extra_text` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`project_id`, `call_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`session_id`) REFERENCES `sessions`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calls_project_started` ON `calls` (`project_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `calls_project_session_started` ON `calls` (`project_id`,`session_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `calls_project_tool_started` ON `calls` (`project_id`,`tool`,`started_at`);--> statement-breakpoint
CREATE INDEX `calls_project_status_started` ON `calls` (`project_id`,`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `calls_project_job` ON `calls` (`project_id`,`job_id`);--> statement-breakpoint
CREATE TABLE `cancel_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`session_id` text NOT NULL,
	`job_id` text NOT NULL,
	`at` integer NOT NULL,
	`status` text NOT NULL,
	`handled_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`session_id`) REFERENCES `sessions`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cancel_project_job` ON `cancel_requests` (`project_id`,`job_id`);--> statement-breakpoint
CREATE INDEX `cancel_project_session_status` ON `cancel_requests` (`project_id`,`session_id`,`status`);--> statement-breakpoint
CREATE TABLE `captures` (
	`project_id` integer NOT NULL,
	`call_id` text NOT NULL,
	`node_id` text NOT NULL,
	`path` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `call_id`, `path`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`call_id`) REFERENCES `calls`(`project_id`,`call_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `captures_project_at` ON `captures` (`project_id`,`at`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`session_id` text NOT NULL,
	`direction` text NOT NULL,
	`chat_id` text NOT NULL,
	`body` text NOT NULL,
	`at` integer NOT NULL,
	`delivered_at` integer,
	`status` text NOT NULL,
	`sender_hash` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`session_id`) REFERENCES `sessions`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_project_session_id` ON `chat_messages` (`project_id`,`session_id`,`id`);--> statement-breakpoint
CREATE INDEX `chat_project_pending` ON `chat_messages` (`project_id`,`session_id`,`direction`,`status`);--> statement-breakpoint
CREATE INDEX `chat_project_chat` ON `chat_messages` (`project_id`,`session_id`,`chat_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`session_id` text NOT NULL,
	`call_id` text,
	`at` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`session_id`) REFERENCES `sessions`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_project_id` ON `events` (`project_id`,`id`);--> statement-breakpoint
CREATE INDEX `events_project_at` ON `events` (`project_id`,`at`);--> statement-breakpoint
CREATE INDEX `events_project_session_at` ON `events` (`project_id`,`session_id`,`at`);--> statement-breakpoint
CREATE INDEX `events_project_call` ON `events` (`project_id`,`call_id`);--> statement-breakpoint
CREATE INDEX `events_project_type_id` ON `events` (`project_id`,`type`,`id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`project_id` integer NOT NULL,
	`id` text NOT NULL,
	`session_id` text NOT NULL,
	`call_id` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`ms` integer,
	`error_type` text,
	`error_message` text,
	`next_step` text,
	`error_line` integer,
	`touched_json` text DEFAULT '[]' NOT NULL,
	PRIMARY KEY(`project_id`, `id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `jobs_project_call` ON `jobs` (`project_id`,`call_id`);--> statement-breakpoint
CREATE INDEX `jobs_project_status` ON `jobs` (`project_id`,`status`);--> statement-breakpoint
CREATE TABLE `meta` (
	`project_id` integer NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`project_id`, `key`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `nodes_touched` (
	`project_id` integer NOT NULL,
	`node_id` text NOT NULL,
	`file_url` text,
	`first_at` integer NOT NULL,
	`last_at` integer NOT NULL,
	`touch_count` integer NOT NULL,
	`last_session_id` text NOT NULL,
	`last_call_id` text NOT NULL,
	PRIMARY KEY(`project_id`, `node_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `permission_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
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
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`session_id`) REFERENCES `sessions`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permission_project_session_request` ON `permission_requests` (`project_id`,`session_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `permission_project_session_id` ON `permission_requests` (`project_id`,`session_id`,`id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`project_id` integer NOT NULL,
	`id` text NOT NULL,
	`started_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`pid` integer,
	`file_url` text,
	`calls` integer DEFAULT 0 NOT NULL,
	`writes` integer DEFAULT 0 NOT NULL,
	`errors` integer DEFAULT 0 NOT NULL,
	`total_ms` integer DEFAULT 0 NOT NULL,
	`chat_token_hash` text,
	PRIMARY KEY(`project_id`, `id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
