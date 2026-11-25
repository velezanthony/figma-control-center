-- FTS5 sobre el texto de los mensajes del chat (contenido externo, como calls_fts) para buscar en toda la conversación.
-- El tokenizador ignora mayúsculas y acentos (remove_diacritics 2). Cada sentencia termina con el marcador de drizzle-kit.
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
END;--> statement-breakpoint
INSERT INTO `chat_messages_fts`(`chat_messages_fts`) VALUES ('rebuild');
