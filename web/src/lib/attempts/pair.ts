export type Pair = { readonly a: number | null; readonly b: number | null };

// Por defecto, el último intento («después») y el anterior («antes»); con uno solo, solo «después»
export function defaultPair(items: readonly { readonly id: number }[]): Pair {
	const last = items[items.length - 1];
	const prev = items[items.length - 2];
	return { a: prev?.id ?? null, b: last?.id ?? null };
}

// El par de la URL si sus ids siguen entre los intentos y no son el mismo; si no, el de por defecto
export function resolvePair(
	items: readonly { readonly id: number }[],
	a: number | null,
	b: number | null,
): Pair {
	if (a === null && b === null) return defaultPair(items);
	const has = (id: number | null) =>
		id === null || items.some((i) => i.id === id);
	if (!has(a) || !has(b) || b === null || a === b) return defaultPair(items);
	return { a, b };
}
