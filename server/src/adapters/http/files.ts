import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { CONTENT_TYPE, FALLBACK_CONTENT_TYPE } from "./routes.ts";

const NUL = "\0";

const isInside = (root: string, candidate: string) =>
	candidate === root || candidate.startsWith(root + sep);

// Convierte la ruta de una URL en un archivo real DENTRO de `root`, o null.
// Resuelve enlaces simbólicos: un enlace que apunta fuera no sirve.
export async function resolveInside(
	root: string,
	urlPath: string,
): Promise<string | null> {
	let decoded: string;
	try {
		decoded = decodeURIComponent(urlPath);
	} catch {
		return null;
	}
	if (decoded.includes(NUL)) return null;
	try {
		const realRoot = await realpath(root);
		const candidate = resolve(realRoot, decoded.replace(/^\/+/, ""));
		if (!isInside(realRoot, candidate)) return null;
		const real = await realpath(candidate);
		if (!isInside(realRoot, real)) return null;
		return (await stat(real)).isFile() ? real : null;
	} catch {
		return null;
	}
}

export const contentTypeOf = (file: string): string =>
	(CONTENT_TYPE as Readonly<Record<string, string>>)[extname(file)] ??
	FALLBACK_CONTENT_TYPE;

export const readBytes = (file: string): Promise<Buffer> => readFile(file);
