import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import {
	type BetterSQLite3Database,
	drizzle,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.ts";

// Valores fijos del programa. Varias sesiones MCP y el panel comparten la base: WAL deja leer mientras
// se escribe, y el plazo de espera hace que un escritor aguarde al otro en vez de fallar
export const SQLITE = Object.freeze({
	busyTimeoutMs: 5000,
	journalMode: "wal",
	synchronous: "normal",
	migrationsFolder: join(import.meta.dirname, "migrations"),
	migrateAttempts: 5,
	migrateRetryMs: 200,
	busyCode: "SQLITE_BUSY",
	alreadyAppliedPattern: /already exists/,
} as const);

// La base única de la máquina: los proyectos y el histórico de todos ellos
export type FigmaDb = BetterSQLite3Database<typeof schema> & {
	$client: Database.Database;
};

const sleepSync = (ms: number): void => {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

const isBusy = (e: unknown): boolean =>
	(e as { code?: string }).code?.startsWith(SQLITE.busyCode) === true;

// Drizzle lee qué migraciones hay aplicadas ANTES de abrir su transacción: si otro proceso migra entre esa
// lectura y el BEGIN, el perdedor intenta crear tablas que ya existen (SQLITE_ERROR, no BUSY). Su transacción
// se deshace entera, así que reintentar es seguro y el segundo intento ya ve el trabajo hecho
const isLostRace = (e: unknown): boolean =>
	isBusy(e) ||
	SQLITE.alreadyAppliedPattern.test(
		String((e as { cause?: Error }).cause?.message),
	);

// Cambiar a WAL y migrar con otro proceso haciendo lo mismo: SQLite devuelve BUSY sin esperar el busy_timeout
// (el cambio de journal_mode no pasa por el manejador de espera), así que el perdedor reintenta él mismo
function withRetry(operation: () => void): void {
	for (let attempt = 1; ; attempt++) {
		try {
			operation();
			return;
		} catch (e) {
			if (!isLostRace(e) || attempt >= SQLITE.migrateAttempts) throw e;
			sleepSync(SQLITE.migrateRetryMs * attempt);
		}
	}
}

export type OpenOptions = {
	// Conexión de solo consulta: el motor rechaza cualquier escritura (los lectores del panel la usan)
	readonly queryOnly?: boolean;
};

// Abre (y migra) la base única con los ajustes de la casa: WAL, espera ante un escritor concurrente y reintento
// si otro proceso migra a la vez
export function openFigmaDatabase(
	file: string,
	options: OpenOptions = {},
): FigmaDb {
	mkdirSync(dirname(file), { recursive: true });
	const client = new Database(file);
	client.pragma(`busy_timeout = ${SQLITE.busyTimeoutMs}`);
	withRetry(() => client.pragma(`journal_mode = ${SQLITE.journalMode}`));
	client.pragma(`synchronous = ${SQLITE.synchronous}`);
	client.pragma("foreign_keys = ON");
	const db = drizzle(client, { schema });
	withRetry(() => migrate(db, { migrationsFolder: SQLITE.migrationsFolder }));
	if (options.queryOnly === true) client.pragma("query_only = ON");
	return db;
}
