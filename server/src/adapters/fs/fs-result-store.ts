import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	ExportName,
	ReadName,
	ResultStore,
	ScreenshotName,
} from "#application/ports/result-store.ts";
import { isResultFileName } from "#domain/result-file.ts";
import type { StoredResult } from "#domain/run-outcome.ts";
import { dayOf, safeName, timeOf, writeUnique } from "./local-files.ts";

// Subcarpetas de la carpeta de salida del proyecto (valores fijos del programa)
const FILE = Object.freeze({
	resultPrefix: "result",
	resultExtension: ".json",
	screenshotDir: "screenshots",
	screenshotExtension: ".png",
	readsDir: "reads",
	exportsDir: "exports",
	resultsDir: "results",
	historyScriptsDir: "history-scripts",
	historyDiffsDir: "history-diffs",
} as const);

// Letras, cifras, «.», «_» y «-», con algo antes de la extensión: nunca una ruta
const DIFF_FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]*\.diff$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export class FsResultStore implements ResultStore {
	readonly #dir: string;

	constructor(dir: string) {
		this.#dir = dir;
	}

	saveJson(json: string): Promise<StoredResult> {
		return this.#save(
			FILE.resultPrefix,
			FILE.resultExtension,
			Buffer.from(json, "utf8"),
		);
	}

	// screenshots/<AAAA-MM-DD>/<nodo>_<HHMMSS>.png con la hora local; si el nombre existe, -2, -3…
	savePng(png: Uint8Array, name: ScreenshotName): Promise<StoredResult> {
		const { at } = name;
		return this.#saveUnique(
			join(this.#dir, FILE.screenshotDir, dayOf(at)),
			`${safeName(name.nodeId)}_${timeOf(at)}`,
			FILE.screenshotExtension,
			png,
		);
	}

	// reads/<herramienta>_<AAAA-MM-DD>_<HHMMSS>.json con la hora local; si el nombre existe, -2, -3…
	saveRead(json: string, name: ReadName): Promise<StoredResult> {
		const { at } = name;
		return this.#saveUnique(
			join(this.#dir, FILE.readsDir),
			`${safeName(name.tool)}_${dayOf(at)}_${timeOf(at)}`,
			FILE.resultExtension,
			Buffer.from(json, "utf8"),
		);
	}

	// exports/<AAAA-MM-DD>/<nodo>_<HHMMSS>.<formato> con la hora local; si el nombre existe, -2, -3…
	saveExport(bytes: Uint8Array, name: ExportName): Promise<StoredResult> {
		const { at } = name;
		return this.#saveUnique(
			join(this.#dir, FILE.exportsDir, dayOf(at)),
			`${safeName(name.nodeId)}_${timeOf(at)}`,
			`.${name.format.toLowerCase()}`,
			bytes,
		);
	}

	// history-scripts/<sha256>.<ext>: el contenido exacto de un intento; se pisa si existe (es el mismo)
	async saveScript(
		sha256: string,
		extension: "js" | "json",
		content: string,
	): Promise<StoredResult> {
		if (!SHA256_HEX.test(sha256)) {
			throw new Error(`hash no válido: «${sha256}» (debía validarse antes)`);
		}
		const dir = join(this.#dir, FILE.historyScriptsDir);
		await mkdir(dir, { recursive: true });
		const path = join(dir, `${sha256}.${extension}`);
		const bytes = Buffer.from(content, "utf8");
		await writeFile(path, bytes);
		return { path, bytes: bytes.byteLength };
	}

	// history-diffs/<nombre>.diff: el diff entero de dos intentos; se pisa si existe
	async saveDiff(fileName: string, text: string): Promise<StoredResult> {
		if (!DIFF_FILE_NAME.test(fileName)) {
			throw new Error(
				`nombre de diff no válido: «${fileName}» (debía sanearse antes)`,
			);
		}
		const dir = join(this.#dir, FILE.historyDiffsDir);
		await mkdir(dir, { recursive: true });
		const path = join(dir, fileName);
		const bytes = Buffer.from(text, "utf8");
		await writeFile(path, bytes);
		return { path, bytes: bytes.byteLength };
	}

	// results/<nombre>: se pisa si existe (lo espera un script que siempre lee la misma ruta)
	async saveResult(fileName: string, json: string): Promise<StoredResult> {
		if (!isResultFileName(fileName)) {
			throw new Error(
				`nombre de resultado no válido: «${fileName}» (debía validarse antes)`,
			);
		}
		const dir = join(this.#dir, FILE.resultsDir);
		await mkdir(dir, { recursive: true });
		const path = join(dir, fileName);
		const bytes = Buffer.from(json, "utf8");
		await writeFile(path, bytes);
		return { path, bytes: bytes.byteLength };
	}

	// Una escritura que falla es un fallo inesperado (disco lleno, permisos): propaga la excepción
	async #save(
		prefix: string,
		extension: string,
		bytes: Uint8Array,
	): Promise<StoredResult> {
		await mkdir(this.#dir, { recursive: true });
		const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
		const path = join(
			this.#dir,
			`${prefix}-${stamp}-${randomUUID().slice(0, 8)}${extension}`,
		);
		await writeFile(path, bytes);
		return { path, bytes: bytes.byteLength };
	}

	#saveUnique(
		dir: string,
		base: string,
		extension: string,
		bytes: Uint8Array,
	): Promise<StoredResult> {
		return writeUnique(dir, base, extension, bytes);
	}
}
