import { randomUUID } from "node:crypto";
import {
	linkSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { BuildLock } from "#application/job-registry.ts";
import { figmaFileKey } from "#domain/figma-url.ts";
import { type JobId, toJobId } from "#domain/job.ts";

// Lock de lote entre procesos (opción A). Cada sesión de Claude Code es un proceso, así que
// «un lote a la vez por pestaña» no puede vivir en memoria: es un fichero por archivo de Figma (por su `fileKey`, no
// por la URL tal cual) en una carpeta de máquina, con el pid de quien lo tiene dentro.
//  - Se crea de forma exclusiva: se escribe completo en un temporal y se enlaza (`link`) al nombre del lock, que falla
//    con EEXIST si ya existe (la misma garantía que O_EXCL, y nadie ve nunca un lock a medio escribir).
//  - Un lock cuyo pid ya no existe está muerto y se puede quitar; sin heurísticas de tiempo. Un pid reutilizado por
//    otro proceso da un falso «ocupado»: raro, y se ve (el mensaje nombra el pid).
//  - Quitar un lock muerto y tomarlo se hace bajo un segundo fichero (`.reap`), también exclusivo, para que dos
//    procesos que ven el mismo lock muerto no se lo quiten el uno al otro.
//  - Se suelta al cerrar el lote y al apagar el proceso (`releaseAll`); con un SIGKILL queda el fichero y se limpia
//    por el pid la próxima vez.

export type FsTabLocksOptions = {
	readonly dir: string;
	readonly pid: number;
	readonly isAlive: (pid: number) => boolean;
	readonly now?: () => Date;
};

type Holder = { readonly pid: number; readonly jobId: string };

const LOCK_EXTENSION = ".lock";
const REAP_EXTENSION = ".reap";
const TEMP_EXTENSION = ".tmp";

const isHolder = (value: unknown): value is Holder =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as Holder).pid === "number" &&
	typeof (value as Holder).jobId === "string";

const code = (e: unknown): string | undefined =>
	(e as NodeJS.ErrnoException).code;

// El nombre del fichero: la clave del archivo; si la URL no trae clave, su forma codificada
const keyOf = (fileUrl: string): string =>
	figmaFileKey(fileUrl) ?? encodeURIComponent(fileUrl);

export function createFsTabLocks(options: FsTabLocksOptions): {
	forUrl(fileUrl: string): BuildLock;
	// Suelta todo lo que este proceso tiene (el apagado)
	releaseAll(): void;
} {
	const { dir, pid, isAlive } = options;
	const now = options.now ?? (() => new Date());
	// Lo que este proceso ha tomado: clave → jobId
	const owned = new Map<string, string>();

	const lockPath = (key: string) => join(dir, `${key}${LOCK_EXTENSION}`);

	// null: no existe, o no se entiende (un fichero ilegible no es de nadie vivo)
	const read = (path: string): Holder | null => {
		let text: string;
		try {
			text = readFileSync(path, "utf8");
		} catch {
			return null;
		}
		try {
			const parsed: unknown = JSON.parse(text);
			return isHolder(parsed) ? parsed : null;
		} catch {
			return null;
		}
	};

	// Escribe el contenido completo en un temporal y lo enlaza a `path`: true si lo ha creado, false si ya existía
	const create = (path: string, jobId: string): boolean => {
		const tmp = `${path}.${pid}.${randomUUID()}${TEMP_EXTENSION}`;
		writeFileSync(
			tmp,
			JSON.stringify({ pid, jobId, at: now().toISOString() }),
			"utf8",
		);
		try {
			linkSync(tmp, path);
			return true;
		} catch (e) {
			if (code(e) === "EEXIST") return false;
			throw e;
		} finally {
			rmSync(tmp, { force: true });
		}
	};

	const liveHolder = (path: string): Holder | null => {
		const holder = read(path);
		return holder !== null && isAlive(holder.pid) ? holder : null;
	};

	// El lock existe pero su dueño ha muerto: se quita y se toma, bajo el fichero de limpieza
	const takeOverDead = (key: string, jobId: string): boolean => {
		const path = lockPath(key);
		const guard = `${path}${REAP_EXTENSION}`;
		if (!create(guard, jobId)) {
			// Otro proceso está limpiando este lock ahora mismo. Si murió a medias, su guarda está muerta
			if (liveHolder(guard) !== null) return false;
			rmSync(guard, { force: true });
			if (!create(guard, jobId)) return false;
		}
		try {
			// Con la guarda en la mano se vuelve a mirar: otro pudo adelantarse
			if (liveHolder(path) !== null) return false;
			rmSync(path, { force: true });
			return create(path, jobId);
		} finally {
			rmSync(guard, { force: true });
		}
	};

	const lockFor = (fileUrl: string): BuildLock => {
		const key = keyOf(fileUrl);
		const path = lockPath(key);
		return {
			acquire(id: JobId): boolean {
				mkdirSync(dir, { recursive: true });
				const taken =
					create(path, id) ||
					(liveHolder(path) === null && takeOverDead(key, id));
				if (taken) owned.set(key, id);
				return taken;
			},
			release(id: JobId): void {
				const holder = read(path);
				if (holder?.pid === pid && holder.jobId === id) {
					rmSync(path, { force: true });
				}
				if (owned.get(key) === id) owned.delete(key);
			},
			active: () => {
				const holder = liveHolder(path);
				return holder === null ? undefined : toJobId(holder.jobId);
			},
			foreignPid: () => {
				const holder = liveHolder(path);
				return holder !== null && holder.pid !== pid ? holder.pid : undefined;
			},
		};
	};

	return {
		forUrl: lockFor,
		releaseAll() {
			for (const [key, jobId] of owned) {
				const path = lockPath(key);
				const holder = read(path);
				if (holder?.pid === pid && holder.jobId === jobId) {
					rmSync(path, { force: true });
				}
			}
			owned.clear();
		},
	};
}
