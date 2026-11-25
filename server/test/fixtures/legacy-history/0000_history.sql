CREATE TABLE `call_nodes` (
	`call_id` text NOT NULL,
	`node_id` text NOT NULL,
	PRIMARY KEY(`call_id`, `node_id`),
	FOREIGN KEY (`call_id`) REFERENCES `calls`(`call_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `call_nodes_node` ON `call_nodes` (`node_id`);--> statement-breakpoint
CREATE TABLE `calls` (
	`call_id` text PRIMARY KEY NOT NULL,
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
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `calls_started` ON `calls` (`started_at`);--> statement-breakpoint
CREATE INDEX `calls_session_started` ON `calls` (`session_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `calls_tool_started` ON `calls` (`tool`,`started_at`);--> statement-breakpoint
CREATE INDEX `calls_status_started` ON `calls` (`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `calls_job` ON `calls` (`job_id`);--> statement-breakpoint
CREATE TABLE `captures` (
	`call_id` text NOT NULL,
	`node_id` text NOT NULL,
	`path` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`at` integer NOT NULL,
	PRIMARY KEY(`call_id`, `path`),
	FOREIGN KEY (`call_id`) REFERENCES `calls`(`call_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `captures_at` ON `captures` (`at`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`call_id` text,
	`at` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_at` ON `events` (`at`);--> statement-breakpoint
CREATE INDEX `events_session_at` ON `events` (`session_id`,`at`);--> statement-breakpoint
CREATE INDEX `events_call` ON `events` (`call_id`);--> statement-breakpoint
CREATE INDEX `events_type_id` ON `events` (`type`,`id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
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
	`touched_json` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_call` ON `jobs` (`call_id`);--> statement-breakpoint
CREATE INDEX `jobs_status` ON `jobs` (`status`);--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `nodes_touched` (
	`node_id` text PRIMARY KEY NOT NULL,
	`file_url` text,
	`first_at` integer NOT NULL,
	`last_at` integer NOT NULL,
	`touch_count` integer NOT NULL,
	`last_session_id` text NOT NULL,
	`last_call_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`pid` integer,
	`file_url` text,
	`calls` integer DEFAULT 0 NOT NULL,
	`writes` integer DEFAULT 0 NOT NULL,
	`errors` integer DEFAULT 0 NOT NULL,
	`total_ms` integer DEFAULT 0 NOT NULL,
	`chat_token_hash` text
);
