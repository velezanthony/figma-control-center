import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { AssetRepository } from "#application/ports/asset-repository.ts";
import type { AssetRecord } from "#domain/attempt.ts";
import { assetReadError, type FigmaError } from "#domain/figma-error.ts";
import { err, ok, type Result } from "#domain/result.ts";
import { insideAnyRoot, relativeToRoot } from "./paths.ts";

export type FsAssetRepositoryOptions = {
	readonly roots: readonly string[];
	// Contra qué se resuelven las rutas relativas
	readonly baseDir: string;
	// Tope del total de bytes de los assets de una llamada o un paso
	readonly maxTotalBytes: number;
};

export class FsAssetRepository implements AssetRepository {
	readonly #roots: readonly string[];
	readonly #baseDir: string;
	readonly #maxTotalBytes: number;

	constructor(options: FsAssetRepositoryOptions) {
		this.#roots = options.roots;
		this.#baseDir = options.baseDir;
		this.#maxTotalBytes = options.maxTotalBytes;
	}

	// Lee todos los assets de la llamada: si alguno falla o el total pasa del tope, no devuelve nada (CA-6)
	async read(
		paths: Readonly<Record<string, string>>,
	): Promise<Result<Readonly<Record<string, Uint8Array>>, FigmaError>> {
		const located = await this.#locate(paths);
		if (!located.ok) return located;
		const out: Record<string, Uint8Array> = {};
		for (const { name, path, real } of located.value) {
			let bytes: Buffer;
			try {
				bytes = await readFile(real);
			} catch (e) {
				return err(
					assetReadError(
						path,
						e instanceof Error ? e.message : "error de lectura.",
					),
				);
			}
			out[name] = new Uint8Array(bytes);
		}
		return ok(out);
	}

	async describe(
		paths: Readonly<Record<string, string>>,
	): Promise<readonly AssetRecord[]> {
		const out: AssetRecord[] = [];
		for (const [name, path] of Object.entries(paths)) {
			try {
				const real = await realpath(resolve(this.#baseDir, path));
				const bytes = await readFile(real);
				out.push({
					name,
					path: (await relativeToRoot(this.#roots, real)) ?? path,
					bytes: bytes.byteLength,
					sha256: createHash("sha256").update(bytes).digest("hex"),
				});
			} catch {
				// un asset ilegible no impide guardar el intento
			}
		}
		return out;
	}

	async check(
		paths: Readonly<Record<string, string>>,
	): Promise<Result<void, FigmaError>> {
		const located = await this.#locate(paths);
		return located.ok ? ok(undefined) : located;
	}

	// Resuelve y comprueba cada asset (raíces, tipo, tope) sin leer su contenido
	async #locate(
		paths: Readonly<Record<string, string>>,
	): Promise<
		Result<readonly { name: string; path: string; real: string }[], FigmaError>
	> {
		const out: { name: string; path: string; real: string }[] = [];
		let total = 0;
		for (const [name, path] of Object.entries(paths)) {
			// realpath: un enlace simbólico o un «..» no pueden sacar el asset de la raíz
			let real: string;
			try {
				real = await realpath(resolve(this.#baseDir, path));
			} catch {
				return err(assetReadError(path, "no existe."));
			}
			if (!(await insideAnyRoot(this.#roots, real))) {
				return err(
					assetReadError(
						path,
						"está fuera de las raíces permitidas (FCC_SCRIPTS_ROOT).",
					),
				);
			}
			// Tope por tamaño ANTES de leer: un asset enorme se rechaza sin cargarlo entero en memoria
			let info: Awaited<ReturnType<typeof stat>>;
			try {
				info = await stat(real);
			} catch (e) {
				return err(
					assetReadError(
						path,
						e instanceof Error ? e.message : "error de lectura.",
					),
				);
			}
			if (!info.isFile()) {
				return err(assetReadError(path, "no es un fichero."));
			}
			total += info.size;
			if (total > this.#maxTotalBytes) {
				return err(
					assetReadError(
						"(assets)",
						`el total supera el tope de ${this.#maxTotalBytes} bytes.`,
					),
				);
			}
			out.push({ name, path, real });
		}
		return ok(out);
	}
}
