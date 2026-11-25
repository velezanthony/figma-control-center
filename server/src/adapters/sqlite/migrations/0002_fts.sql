-- FTS5 no existe en Drizzle: tablas virtuales de contenido externo sobre `calls` y `chat_messages`, y los triggers que
-- las mantienen. El índice no sabe de proyectos: quien busca une siempre con la tabla de datos filtrada por `project_id`
-- (sqlite-history-query.ts y sqlite-chat.ts), así que una búsqueda nunca cruza proyectos.
-- Cada sentencia termina con el marcador de drizzle-kit: un trigger lleva `;` dentro y partirlo por «;» lo rompería.
CREATE VIRTUAL TABLE `calls_fts` USING fts5(
	`summary`,
	`error_message`,
	`tool`,
	`extra_text`,
	content='calls',
	content_rowid='rowid'
);--> statement-breakpoint
CREATE TRIGGER `calls_fts_ai` AFTER INSERT ON `calls` BEGIN
	INSERT INTO `calls_fts`(`rowid`, `summary`, `error_message`, `tool`, `extra_text`)
	VALUES (new.`rowid`, new.`summary`, coalesce(new.`error_message`, ''), new.`tool`, new.`extra_text`);
END;--> statement-breakpoint
CREATE TRIGGER `calls_fts_ad` AFTER DELETE ON `calls` BEGIN
	INSERT INTO `calls_fts`(`calls_fts`, `rowid`, `summary`, `error_message`, `tool`, `extra_text`)
	VALUES ('delete', old.`rowid`, old.`summary`, coalesce(old.`error_message`, ''), old.`tool`, old.`extra_text`);
END;--> statement-breakpoint
CREATE TRIGGER `calls_fts_au` AFTER UPDATE ON `calls` BEGIN
	INSERT INTO `calls_fts`(`calls_fts`, `rowid`, `summary`, `error_message`, `tool`, `extra_text`)
	VALUES ('delete', old.`rowid`, old.`summary`, coalesce(old.`error_message`, ''), old.`tool`, old.`extra_text`);
	INSERT INTO `calls_fts`(`rowid`, `summary`, `error_message`, `tool`, `extra_text`)
	VALUES (new.`rowid`, new.`summary`, coalesce(new.`error_message`, ''), new.`tool`, new.`extra_text`);
END;--> statement-breakpoint
CREATE VIRTUAL TABLE `chat_messages_fts` USING fts5(
	`body`,
	content='chat_messages',
	content_rowid='id',
	tokenize='unicode61 remove_diacritics 2'
);--> statement-breakpoint
CREATE TRIGGER `chat_fts_ai` AFTER INSERT ON `chat_messages` BEGIN
	INSERT INTO `chat_messages_fts`(`rowid`, `body`) VALUES (new.`id`, new.`body`);
END;--> statement-breakpoint
CREATE TRIGGER `chat_fts_ad` AFTER DELETE ON `chat_messages` BEGIN
	INSERT INTO `chat_messages_fts`(`chat_messages_fts`, `rowid`, `body`) VALUES ('delete', old.`id`, old.`body`);
END;--> statement-breakpoint
CREATE TRIGGER `chat_fts_au` AFTER UPDATE ON `chat_messages` BEGIN
	INSERT INTO `chat_messages_fts`(`chat_messages_fts`, `rowid`, `body`) VALUES ('delete', old.`id`, old.`body`);
	INSERT INTO `chat_messages_fts`(`rowid`, `body`) VALUES (new.`id`, new.`body`);
END;
