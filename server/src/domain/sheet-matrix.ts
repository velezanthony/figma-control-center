// Las etiquetas de la matriz de una hoja: fila = valor de las propiedades de `rows` (por defecto, la primera propiedad de la primera
// variante); columna = las demás propiedades de la fila más larga, sin los valores neutros. Puro y sin Figma.
import type { ComponentMatrix } from "./component-plan.ts";

const NEUTRAL = ["none", "default", "false"];
const SEPARATOR = " · ";

export function matrixOf(
	variants: readonly Readonly<Record<string, string>>[],
	rows?: readonly string[],
): ComponentMatrix {
	const first = Object.keys(variants[0] ?? {})[0];
	const rowKeys = rows ?? (first === undefined ? [] : [first]);
	const labels: string[] = [];
	const cells: number[][] = [];
	const rowOf = new Map<string, number>();
	for (const [i, props] of variants.entries()) {
		const label = rowKeys.map((r) => `${r}=${props[r]}`).join(SEPARATOR);
		let at = rowOf.get(label);
		if (at === undefined) {
			at = labels.length;
			rowOf.set(label, at);
			labels.push(label);
			cells.push([]);
		}
		cells[at]?.push(i);
	}
	let longest: readonly number[] = [];
	for (const row of cells) if (row.length > longest.length) longest = row;
	const columns = longest.map((index) => {
		const props = variants[index] ?? {};
		const text = Object.entries(props)
			.filter(([k, v]) => !rowKeys.includes(k) && !NEUTRAL.includes(v))
			.map(([k, v]) => `${k}=${v}`)
			.join(SEPARATOR);
		return (
			text || (Object.keys(props).length > rowKeys.length ? "default" : "")
		);
	});
	return {
		rows: labels,
		columns: columns.some(Boolean) ? columns : [],
		cells,
	};
}
