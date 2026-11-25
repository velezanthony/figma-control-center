// El estado de una búsqueda en el chat, sin DOM: unir resultados, moverse entre ellos y planear la carga que hace falta
// para llegar a un mensaje antiguo

export const mergeResults = (
	local: readonly number[],
	remote: readonly number[],
): number[] => [...new Set([...local, ...remote])].sort((a, b) => a - b);

export function stepResult(
	ids: readonly number[],
	current: number | null,
	direction: 1 | -1,
): number | null {
	if (ids.length === 0) return null;
	const first = ids[0] as number;
	const last = ids[ids.length - 1] as number;
	if (current === null) return direction > 0 ? first : last;
	const at = ids.indexOf(current);
	if (at !== -1) {
		return ids[(at + direction + ids.length) % ids.length] as number;
	}
	// El actual ya no es resultado: se sigue desde donde estaba por id
	return direction > 0
		? (ids.find((id) => id > current) ?? first)
		: (ids.findLast((id) => id < current) ?? last);
}

// Al buscar se salta al más reciente, que es donde se está leyendo; si el actual sigue siendo resultado, se queda
export function initialResult(
	ids: readonly number[],
	current: number | null,
): number | null {
	if (ids.length === 0) return null;
	return current !== null && ids.includes(current)
		? current
		: (ids[ids.length - 1] as number);
}

export function countLabel(a: {
	readonly ids: readonly number[];
	readonly current: number | null;
	readonly searching: boolean;
	readonly truncated: boolean;
}): string {
	if (a.ids.length === 0) return a.searching ? "Buscando…" : "Sin resultados";
	const position = Math.max(
		1,
		(a.current === null ? -1 : a.ids.indexOf(a.current)) + 1,
	);
	return `${position} de ${a.ids.length}${a.truncated ? "+" : ""}`;
}

// Llegar a un mensaje más antiguo que lo cargado sin dejar huecos: se pide desde justo antes de él hacia delante y,
// tras cada tanda, desde el último id recibido, hasta enlazar con lo que ya había. null: nada que pedir
export function jumpPlan(a: {
	readonly oldestLoaded: number | null;
	readonly targetId: number;
	readonly cursor: number | null;
}): { after: number } | null {
	if (a.oldestLoaded === null || a.targetId >= a.oldestLoaded) return null;
	const cursor = a.cursor ?? a.targetId - 1;
	return cursor >= a.oldestLoaded - 1 ? null : { after: cursor };
}
