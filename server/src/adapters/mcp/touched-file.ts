import type { ResultStore } from "#application/ports/result-store.ts";

// Los ids tocados de un lote pueden ser miles: si no caben en línea, la lista entera va a un fichero y la respuesta
// lleva solo los primeros que caben (mismo umbral que el resultado de figma_run_script)
export type TouchedLimit = {
	readonly store: ResultStore;
	readonly maxInlineBytes: number;
};

const encoder = new TextEncoder();
const bytesOf = (text: string): number => encoder.encode(text).byteLength;
const ARRAY_BRACKETS_BYTES = 2;
const COMMA_BYTES = 1;

// Los primeros ids cuyo JSON cabe en `maxBytes`
export function fitInline(
	ids: readonly string[],
	maxBytes: number,
): readonly string[] {
	let total = ARRAY_BRACKETS_BYTES;
	let count = 0;
	for (const id of ids) {
		total += bytesOf(JSON.stringify(id)) + (count > 0 ? COMMA_BYTES : 0);
		if (total > maxBytes) break;
		count++;
	}
	return ids.slice(0, count);
}

export async function limitTouched<
	T extends { readonly touchedNodeIds: readonly string[] },
>(
	output: T,
	limit: TouchedLimit,
): Promise<
	Omit<T, "touchedNodeIds"> & {
		readonly touchedNodeIds: readonly string[];
		readonly touchedPath: string | null;
	}
> {
	const json = JSON.stringify(output.touchedNodeIds);
	if (bytesOf(json) <= limit.maxInlineBytes) {
		return { ...output, touchedPath: null };
	}
	const stored = await limit.store.saveJson(json);
	return {
		...output,
		touchedNodeIds: fitInline(output.touchedNodeIds, limit.maxInlineBytes),
		touchedPath: stored.path,
	};
}
