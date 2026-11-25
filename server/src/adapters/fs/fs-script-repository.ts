import { readFile, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { ScriptRepository } from "#application/ports/script-repository.ts";
import { type FigmaError, scriptReadError } from "#domain/figma-error.ts";
import { err, ok, type Result } from "#domain/result.ts";
import { insideAnyRoot, relativeToRoot } from "./paths.ts";

export type FsScriptRepositoryOptions = {
	readonly roots: readonly string[];
	// Contra qué se resuelven las rutas relativas
	readonly baseDir: string;
};

export class FsScriptRepository implements ScriptRepository {
	readonly #roots: readonly string[];
	readonly #baseDir: string;

	constructor(options: FsScriptRepositoryOptions) {
		this.#roots = options.roots;
		this.#baseDir = options.baseDir;
	}

	async identity(path: string): Promise<string> {
		try {
			const real = await realpath(resolve(this.#baseDir, path));
			return (await relativeToRoot(this.#roots, real)) ?? path;
		} catch {
			return path;
		}
	}

	async read(path: string): Promise<Result<string, FigmaError>> {
		// realpath en ambos lados: un enlace simbólico o un «..» no pueden sacar el script de la raíz
		let real: string;
		try {
			real = await realpath(resolve(this.#baseDir, path));
		} catch {
			return err(scriptReadError(path, "no existe."));
		}
		if (!(await insideAnyRoot(this.#roots, real))) {
			return err(
				scriptReadError(
					path,
					"está fuera de las raíces permitidas (FCC_SCRIPTS_ROOT).",
				),
			);
		}
		try {
			if (!(await stat(real)).isFile()) {
				return err(scriptReadError(path, "no es un fichero."));
			}
			return ok(await readFile(real, "utf8"));
		} catch (e) {
			return err(
				scriptReadError(
					path,
					e instanceof Error ? e.message : "error de lectura.",
				),
			);
		}
	}
}
