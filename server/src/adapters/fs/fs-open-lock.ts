import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// Lock para abrir la pestaña de un archivo de Figma (D-2 B): un fichero por clave de archivo en la carpeta de locks de
// máquina (FCC_LOCK_DIR). Se crea de forma exclusiva (`wx`); si ya existe y quien lo tiene ya no vive, se quita; si
// vive, se espera. Dos sesiones que no encuentran la pestaña a la vez abren una sola.

export type FsOpenLockOptions = {
	readonly dir: string;
	readonly pid: number;
	readonly isAlive: (pid: number) => boolean;
	// Cada cuánto se reintenta y cuánto se espera como máximo antes de fallar
	readonly pollMs: number;
	readonly timeoutMs: number;
};

const EXTENSION = ".lock";
const PREFIX = "open-";

const code = (e: unknown): string | undefined =>
	(e as NodeJS.ErrnoException).code;

function holderPid(path: string): number | null {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		const pid = (parsed as { pid?: unknown }).pid;
		return typeof pid === "number" ? pid : null;
	} catch {
		return null;
	}
}

export function createFsOpenLock(options: FsOpenLockOptions): {
	withLock<T>(fileKey: string, run: () => Promise<T>): Promise<T>;
} {
	const { dir, pid, isAlive, pollMs, timeoutMs } = options;

	const take = async (path: string): Promise<void> => {
		mkdirSync(dir, { recursive: true });
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			try {
				writeFileSync(path, JSON.stringify({ pid }), { flag: "wx" });
				return;
			} catch (e) {
				if (code(e) !== "EEXIST") throw e;
			}
			const holder = holderPid(path);
			// Un fichero ilegible o de un proceso muerto no lo tiene nadie: se quita y se reintenta
			if (holder === null || !isAlive(holder)) {
				rmSync(path, { force: true });
				continue;
			}
			if (Date.now() >= deadline) {
				throw new Error(
					`No se pudo abrir la pestaña: otra sesión (pid ${holder}) la está abriendo y no terminó a tiempo.`,
				);
			}
			await sleep(pollMs);
		}
	};

	return {
		async withLock(fileKey, run) {
			const path = join(
				dir,
				`${PREFIX}${encodeURIComponent(fileKey)}${EXTENSION}`,
			);
			await take(path);
			try {
				return await run();
			} finally {
				rmSync(path, { force: true });
			}
		},
	};
}
