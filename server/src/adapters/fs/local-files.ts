// Nombres de fichero con la fecha y la hora LOCALES de quien ejecuta, y la escritura que no pisa (-2, -3…). Lo comparten
// los almacenes de la carpeta de salida (fs-result-store, fs-web-capture-store).
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StoredResult } from "#domain/run-outcome.ts";

const EXISTS = "EEXIST";
const NOT_NAME_CHARS = /[^A-Za-z0-9-]/g;
const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

export const dayOf = (at: Date): string =>
	`${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
export const timeOf = (at: Date): string =>
	`${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`;
export const safeName = (text: string): string =>
	text.replaceAll(":", "-").replace(NOT_NAME_CHARS, "_");

// <dir>/<base>.<ext>; si el nombre existe, <base>-2, -3…
export async function writeUnique(
	dir: string,
	base: string,
	extension: string,
	bytes: Uint8Array,
): Promise<StoredResult> {
	await mkdir(dir, { recursive: true });
	for (let attempt = 1; ; attempt++) {
		const suffix = attempt === 1 ? "" : `-${attempt}`;
		const path = join(dir, `${base}${suffix}${extension}`);
		try {
			await writeFile(path, bytes, { flag: "wx" });
			return { path, bytes: bytes.byteLength };
		} catch (e) {
			if ((e as { code?: string }).code !== EXISTS) throw e;
		}
	}
}
