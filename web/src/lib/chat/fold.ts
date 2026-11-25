// Comparar sin mayúsculas ni acentos, igual en la lista cargada y en el resaltado. El servidor (FTS5, tokenizador
// unicode61 con remove_diacritics) también ignora acentos y mayúsculas, pero busca palabras y prefijos; aquí se busca
// cualquier trozo de texto. Por eso lo que se encuentra en el cliente puede ser más que lo del servidor, no menos

export type TextRange = { readonly start: number; readonly end: number };

const COMBINING_MARKS = /\p{M}/gu;

// El texto plegado y, para cada unidad plegada, dónde empezaba su carácter en el original (para volver a coordenadas
// del original al resaltar)
export function fold(source: string): { text: string; map: number[] } {
	let text = "";
	const map: number[] = [];
	let index = 0;
	for (const char of source) {
		const piece = char
			.normalize("NFD")
			.replace(COMBINING_MARKS, "")
			.toLowerCase();
		for (let i = 0; i < piece.length; i++) map.push(index);
		text += piece;
		index += char.length;
	}
	return { text, map };
}

export const foldQuery = (query: string): string => fold(query.trim()).text;

// Todas las apariciones (sin solaparse) de `query` en `text`, en coordenadas del texto original
export function findRanges(text: string, query: string): TextRange[] {
	const needle = foldQuery(query);
	if (needle === "") return [];
	const haystack = fold(text);
	const ranges: TextRange[] = [];
	let from = 0;
	for (;;) {
		const at = haystack.text.indexOf(needle, from);
		if (at === -1) return ranges;
		ranges.push({
			start: haystack.map[at] ?? 0,
			end: haystack.map[at + needle.length] ?? text.length,
		});
		from = at + needle.length;
	}
}

// El texto troceado en lo que se resalta y lo que no, sin trozos vacíos; unidos dan el texto original
export function splitByRanges(
	text: string,
	ranges: readonly TextRange[],
): { text: string; hit: boolean }[] {
	const parts: { text: string; hit: boolean }[] = [];
	let last = 0;
	for (const range of ranges) {
		if (range.start > last) {
			parts.push({ text: text.slice(last, range.start), hit: false });
		}
		parts.push({ text: text.slice(range.start, range.end), hit: true });
		last = range.end;
	}
	if (last < text.length || parts.length === 0) {
		parts.push({ text: text.slice(last), hit: false });
	}
	return parts;
}
