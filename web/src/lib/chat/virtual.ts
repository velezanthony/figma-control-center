// Matemática de la lista virtualizada: puro y sin DOM, para poder probarlo. El componente (atoms/VirtualList) solo
// mide, llama a esto y pinta lo que diga el rango.
//
// `offsets[i]` es dónde empieza el elemento i; `offsets[n]` es el alto total. Un elemento sin medir vale la
// estimación; en cuanto se monta y se mide, vale su altura real.

export type Range = { readonly start: number; readonly end: number };
// El elemento que había bajo el borde superior y cuánto se había entrado en él
export type Anchor<K> = { readonly key: K; readonly delta: number };

// Por debajo de esto una diferencia de altura es ruido de redondeo del navegador y no se anota
const MEASURE_EPSILON_PX = 0.5;

export function buildOffsets<K>(
	keys: readonly K[],
	heights: ReadonlyMap<K, number>,
	estimate: number,
): number[] {
	const offsets = new Array<number>(keys.length + 1);
	let y = 0;
	for (const [i, key] of keys.entries()) {
		offsets[i] = y;
		y += heights.get(key) ?? estimate;
	}
	offsets[keys.length] = y;
	return offsets;
}

// Búsqueda binaria: el primer índice cuyo desplazamiento es >= y (n + 1 si no hay ninguno)
function lowerBound(offsets: readonly number[], y: number): number {
	let low = 0;
	let high = offsets.length;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if ((offsets[mid] ?? 0) < y) low = mid + 1;
		else high = mid;
	}
	return low;
}

// El elemento que contiene la coordenada y, acotado a [0, n - 1]
export function indexAt(offsets: readonly number[], y: number): number {
	const n = offsets.length - 1;
	if (n <= 0) return 0;
	const first = lowerBound(offsets, y);
	const index = (offsets[first] ?? 0) === y ? first : first - 1;
	return Math.min(n - 1, Math.max(0, index));
}

// Los elementos que se montan: los que tocan el viewport más `overscanPx` por arriba y por abajo
export function visibleRange(
	offsets: readonly number[],
	scrollTop: number,
	viewportHeight: number,
	overscanPx: number,
): Range {
	const n = offsets.length - 1;
	if (n <= 0) return { start: 0, end: 0 };
	const start = indexAt(offsets, scrollTop - overscanPx);
	const end = Math.min(
		n,
		lowerBound(offsets, scrollTop + viewportHeight + overscanPx),
	);
	return { start, end: Math.max(end, start + 1) };
}

// Un elemento con el foco (un enlace, el botón de copiar) no se puede desmontar: se amplía el rango hasta cubrirlo
export function includeIndex(range: Range, index: number, n: number): Range {
	if (index < 0 || index >= n) return range;
	return {
		start: Math.min(range.start, index),
		end: Math.max(range.end, index + 1),
	};
}

export function captureAnchor<K>(
	keys: readonly K[],
	offsets: readonly number[],
	scrollTop: number,
): Anchor<K> | null {
	const index = indexAt(offsets, scrollTop);
	const key = keys[index];
	return key === undefined
		? null
		: { key, delta: scrollTop - (offsets[index] ?? 0) };
}

// El scroll que deja el ancla donde estaba en pantalla tras cambiar las alturas o añadir elementos arriba
export function restoreAnchor<K>(
	anchor: Anchor<K>,
	keys: readonly K[],
	offsets: readonly number[],
): number | null {
	const index = keys.indexOf(anchor.key);
	return index === -1 ? null : (offsets[index] ?? 0) + anchor.delta;
}

// Anota alturas medidas; devuelve si cambió algo que obligue a recalcular. Un elemento oculto mide 0 y se ignora
export function applyMeasurements<K>(
	heights: Map<K, number>,
	measured: readonly (readonly [K, number])[],
): boolean {
	let changed = false;
	for (const [key, height] of measured) {
		if (!Number.isFinite(height) || height <= 0) continue;
		const known = heights.get(key);
		if (known === undefined || Math.abs(known - height) >= MEASURE_EPSILON_PX) {
			heights.set(key, height);
			changed = true;
		}
	}
	return changed;
}
// Los elementos que se ven de verdad: los que asoman al menos `minVisiblePx` (o enteros, si son más bajos). Un
// elemento que solo enseña su borde no cuenta como visto
export function keysInView<K>(
	keys: readonly K[],
	offsets: readonly number[],
	scrollTop: number,
	viewportHeight: number,
	minVisiblePx: number,
): K[] {
	if (viewportHeight <= 0) return [];
	const bottom = scrollTop + viewportHeight;
	const seen: K[] = [];
	for (let i = indexAt(offsets, scrollTop); i < keys.length; i++) {
		const top = offsets[i] ?? 0;
		if (top >= bottom) break;
		const end = offsets[i + 1] ?? top;
		const shown = Math.min(end, bottom) - Math.max(top, scrollTop);
		const key = keys[i];
		if (key !== undefined && shown >= Math.min(end - top, minVisiblePx))
			seen.push(key);
	}
	return seen;
}
