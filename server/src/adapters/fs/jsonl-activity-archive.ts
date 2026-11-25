import { readFile } from "node:fs/promises";
import { join, parse } from "node:path";
import type { ActivityArchive } from "#application/ports/activity-archive.ts";
import { type ActivityEvent, isActivityEvent } from "#domain/activity.ts";

const ROTATED_SUFFIX = ".1";
const NOT_FOUND = "ENOENT";

// activity.jsonl → activity.1.jsonl (la generación anterior, de cuando el archivo rotaba)
export function rotatedPath(file: string): string {
	const { dir, name, ext } = parse(file);
	return join(dir, `${name}${ROTATED_SUFFIX}${ext}`);
}

// Una línea mal formada (escritura a medias, otra versión, basura) se descarta sin romper nada
function parseLines(text: string): ActivityEvent[] {
	const found: ActivityEvent[] = [];
	for (const line of text.split("\n")) {
		if (line === "") continue;
		try {
			const parsed: unknown = JSON.parse(line);
			if (isActivityEvent(parsed)) found.push(parsed);
		} catch {
			// línea inválida
		}
	}
	return found;
}

async function readText(path: string): Promise<string> {
	try {
		return await readFile(path, "utf8");
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === NOT_FOUND) return "";
		throw e;
	}
}

// Solo lectura y solo para importar el archivo que el histórico en SQLite sustituyó
export class JsonlActivityArchive implements ActivityArchive {
	readonly #file: string;

	constructor(options: { readonly file: string }) {
		this.#file = options.file;
	}

	async readAll(): Promise<readonly ActivityEvent[]> {
		const older = await readText(rotatedPath(this.#file));
		const active = await readText(this.#file);
		return [...parseLines(older), ...parseLines(active)];
	}
}
