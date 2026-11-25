CREATE TABLE `build_steps` (
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
	PRIMARY KEY(`job_id`, `step_index`)
);
