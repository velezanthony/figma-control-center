-- FTS5 no existe en Drizzle: tabla virtual de contenido externo sobre `calls` y los triggers que la mantienen.
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
END;
