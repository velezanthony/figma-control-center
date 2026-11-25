import { asc, eq, max, sql } from "drizzle-orm";
import type { ProjectRegistry } from "#application/ports/project-registry.ts";
import { figmaFileKey, figmaFileUrlProblem } from "#domain/figma-url.ts";
import {
	type EntryDraft,
	MAX_PROJECT_ID,
	type Registry,
	type RegistryEntry,
	type RegistryError,
	registryError,
} from "#domain/registry.ts";
import { err, ok, type Result } from "#domain/result.ts";
import type { FigmaDb } from "./database.ts";
import { projects } from "./schema.ts";

const WRITE_TX = { behavior: "immediate" } as const;
const UNIQUE_CODE = "SQLITE_CONSTRAINT_UNIQUE";
const UNIQUE_COLUMN = /UNIQUE constraint failed: projects\.(\w+)/;
const TRAILING_SLASHES = /(?<=.)\/+$/;

type Row = typeof projects.$inferSelect;

// Qué columna única chocó y cómo se dice al usuario
const CONFLICT_COLUMNS = {
	file_key: {
		column: projects.fileKey,
		field: "fileKey",
		text: "el archivo de Figma",
	},
	output_dir: {
		column: projects.outputDir,
		field: "outputDir",
		text: "outputDir",
	},
} as const;

const normalized = (path: string): string => path.replace(TRAILING_SLASHES, "");

// Un fallo que ya es un error del puerto: sale de la transacción (que se deshace) tal cual
class Bad extends Error {
	readonly error: RegistryError;
	constructor(error: RegistryError) {
		super(error.message);
		this.error = error;
	}
}

// Lo que una transacción de Drizzle y la base misma tienen en común
type Q = Pick<FigmaDb, "select" | "insert" | "update" | "delete" | "get">;

// El registro de proyectos sobre la base única. Cada operación es una transacción de
// escritura: dos escritores a la vez se esperan, no se pisan. Los índices únicos de la tabla hacen de guardia.
export class SqliteRegistry implements ProjectRegistry {
	readonly #db: FigmaDb;
	readonly #placeFor: (id: string) => string;
	readonly #reservedIds: () => readonly number[];

	constructor(options: {
		readonly db: FigmaDb;
		// Dónde va la carpeta de ficheros de un proyecto que no la fija (<salida>/<id>)
		readonly placeFor: (id: string) => string;
		// Números de carpeta que ya existen en el directorio de salida: el id nuevo los supera
		readonly reservedIds?: () => readonly number[];
	}) {
		this.#db = options.db;
		this.#placeFor = options.placeFor;
		this.#reservedIds = options.reservedIds ?? (() => []);
	}

	async read(): Promise<Result<Registry, RegistryError>> {
		try {
			const entries: RegistryEntry[] = [];
			const problems: string[] = [];
			const rows = this.#db
				.select()
				.from(projects)
				.orderBy(asc(projects.id))
				.all();
			for (const row of rows) {
				const parsed = toEntry(row);
				if (typeof parsed === "string") {
					problems.push(`proyecto ${row.id} ignorado: ${parsed}`);
				} else {
					entries.push(parsed);
				}
			}
			return ok({ entries, ...(problems.length > 0 && { problems }) });
		} catch {
			return err(registryError("unreadable", "no se pudo leer la base"));
		}
	}

	async add(draft: EntryDraft): Promise<Result<RegistryEntry, RegistryError>> {
		return this.#write(() =>
			this.#db.transaction((tx) => this.#insert(tx, draft), WRITE_TX),
		);
	}

	async update(entry: RegistryEntry): Promise<Result<void, RegistryError>> {
		const done = await this.#write(() =>
			this.#db.transaction((tx) => {
				const values = this.#values(entry, entry.id);
				const changed = conflictAware(
					tx,
					values,
					Number(entry.id),
					() =>
						tx
							.update(projects)
							.set(values)
							.where(eq(projects.id, Number(entry.id)))
							.run().changes,
				);
				if (changed === 0) {
					throw new Bad(
						registryError("notFound", `No existe el proyecto ${entry.id}.`),
					);
				}
			}, WRITE_TX),
		);
		return done.ok ? ok(undefined) : done;
	}

	async remove(id: string): Promise<Result<void, RegistryError>> {
		const done = await this.#write(() =>
			this.#db.transaction((tx) => {
				tx.delete(projects)
					.where(eq(projects.id, Number(id)))
					.run();
			}, WRITE_TX),
		);
		return done.ok ? ok(undefined) : done;
	}

	// El id nuevo es el mayor entre el último que dio la tabla (aunque se borrara), las filas y las carpetas numéricas
	// que ya existen, más uno. Dentro de la transacción de escritura nadie más inserta entre medias.
	#insert(q: Q, draft: EntryDraft): RegistryEntry {
		const sequence = q.get<{ seq: number } | undefined>(
			sql`SELECT seq FROM sqlite_sequence WHERE name = 'projects'`,
		);
		const last = q
			.select({ top: max(projects.id) })
			.from(projects)
			.get();
		const id =
			Math.max(sequence?.seq ?? 0, last?.top ?? 0, ...this.#reservedIds()) + 1;
		if (id > MAX_PROJECT_ID) {
			throw new Bad(
				registryError(
					"malformed",
					`se alcanzó el máximo de ${MAX_PROJECT_ID} proyectos`,
				),
			);
		}
		const values = this.#values(draft, String(id));
		const row = conflictAware(q, values, id, () =>
			q
				.insert(projects)
				.values({ id, ...values })
				.returning()
				.get(),
		);
		return unwrap(toEntry(row));
	}

	#values(draft: EntryDraft, id: string) {
		const key = figmaFileKey(draft.fileUrl);
		if (key === null) {
			throw new Bad(
				registryError("malformed", "la URL no es de un archivo de Figma"),
			);
		}
		return {
			name: draft.name,
			projectDir: draft.projectDir,
			fileUrl: draft.fileUrl,
			fileKey: key,
			scriptsRoots:
				draft.scriptsRoots === undefined
					? null
					: JSON.stringify(draft.scriptsRoots),
			outputDir: normalized(draft.outputDir ?? this.#placeFor(id)),
		};
	}

	// Convierte lo que lance una operación en el error del puerto
	async #write<T>(run: () => T): Promise<Result<T, RegistryError>> {
		try {
			return ok(run());
		} catch (e) {
			if (e instanceof Bad) return err(e.error);
			return err(registryError("unreadable", "no se pudo escribir la base"));
		}
	}
}

function unwrap(parsed: RegistryEntry | string): RegistryEntry {
	if (typeof parsed === "string") {
		throw new Bad(registryError("malformed", parsed));
	}
	return parsed;
}

// La fila como entrada del registro, o por qué no vale
function toEntry(row: Row): RegistryEntry | string {
	const problem = figmaFileUrlProblem(row.fileUrl);
	if (problem !== null) return problem;
	let scriptsRoots: string[] | undefined;
	if (row.scriptsRoots !== null) {
		try {
			const parsed: unknown = JSON.parse(row.scriptsRoots);
			if (
				!Array.isArray(parsed) ||
				!parsed.every((p) => typeof p === "string")
			) {
				return "las raíces de scripts no son una lista de rutas";
			}
			scriptsRoots = parsed;
		} catch {
			return "las raíces de scripts no son una lista de rutas";
		}
	}
	return {
		id: String(row.id),
		name: row.name,
		projectDir: row.projectDir,
		fileUrl: row.fileUrl,
		...(scriptsRoots !== undefined && { scriptsRoots }),
		outputDir: row.outputDir,
	};
}

// Ejecuta una escritura y, si un índice único la rechaza, dice qué proyecto ya tenía eso (la transacción se deshace)
function conflictAware<T>(
	q: Q,
	values: { fileKey: string; outputDir: string },
	selfId: number,
	run: () => T,
): T {
	try {
		return run();
	} catch (e) {
		const inner = (e as { cause?: unknown }).cause ?? e;
		const { code, message } = inner as { code?: string; message?: string };
		if (code !== UNIQUE_CODE) throw e;
		const name = UNIQUE_COLUMN.exec(message ?? "")?.[1];
		const known = CONFLICT_COLUMNS[name as keyof typeof CONFLICT_COLUMNS];
		if (known === undefined) {
			throw new Bad(
				registryError("conflict", "otro proyecto ya usa esos datos"),
			);
		}
		const value = values[known.field];
		const other = q
			.select({ id: projects.id, name: projects.name })
			.from(projects)
			.where(eq(known.column, value))
			.all()
			.find((r) => r.id !== selfId);
		throw new Bad(
			registryError(
				"conflict",
				other === undefined
					? `${known.text} ya lo usa otro proyecto`
					: `${known.text} ya lo usa el proyecto «${other.name}»`,
			),
		);
	}
}
