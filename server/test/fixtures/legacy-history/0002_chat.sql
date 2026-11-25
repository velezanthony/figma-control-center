CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`direction` text NOT NULL,
	`chat_id` text NOT NULL,
	`body` text NOT NULL,
	`at` integer NOT NULL,
	`delivered_at` integer,
	`status` text NOT NULL,
	`sender_hash` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_session_id` ON `chat_messages` (`session_id`,`id`);--> statement-breakpoint
CREATE INDEX `chat_pending` ON `chat_messages` (`session_id`,`direction`,`status`);--> statement-breakpoint
CREATE INDEX `chat_chat` ON `chat_messages` (`session_id`,`chat_id`);