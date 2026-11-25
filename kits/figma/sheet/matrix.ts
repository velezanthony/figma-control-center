// La matriz con etiquetas: las etiquetas van en un marco envoltorio (dentro de un set solo caben
// componentes); cada variante se centra en su celda, el set crece a lo que ocupan y la tarjeta y la cabecera a su ancho.
import { figmaApi } from "../core.ts";
import { setPaints } from "../paints.ts";
import type { FrameNode, TextNode } from "../types.ts";
import { type StyleVariables, sheetText } from "./header.ts";
import type { SetVariant } from "./set.ts";
import type { ComponentPlan } from "./types.ts";

const GAP = 32;
const PAD = 40;
const LABEL_GAP = 16;
const EMPTY_COLUMN = "—";
const DASH = [6, 4];

export function createMatrixFrame(plan: ComponentPlan, card: FrameNode) {
	const matrix = figmaApi().createFrame();
	matrix.name = `${plan.sheet.title} — matriz`;
	matrix.fills = [];
	matrix.clipsContent = false;
	card.appendChild(matrix);
	return matrix;
}

export function layOutMatrix(
	plan: ComponentPlan,
	vars: StyleVariables,
	input: {
		matrix: FrameNode;
		set: { x: number; y: number; width: number; height: number };
		variants: readonly SetVariant[];
		card: FrameNode;
		head: FrameNode;
	},
): void {
	const { matrix, variants, card, head } = input;
	const set = input.set as unknown as FrameNode;
	const top = plan.sheet.matrix?.align === "top";
	const byIndex = new Map(variants.map((v) => [v.index, v.component]));
	const grid = plan.matrix.cells.map((row) =>
		row.flatMap((i) => {
			const c = byIndex.get(i);
			return c === undefined ? [] : [c];
		}),
	);
	const ncol = Math.max(0, ...grid.map((r) => r.length));
	const label = (
		s: string,
		size: number,
		weight: "500" | "600",
		v: typeof vars.colLabel,
	) => {
		const t = sheetText(plan, s, size, weight, v);
		matrix.appendChild(t);
		return t;
	};
	const colL: TextNode[] = plan.matrix.columns.map((s) =>
		label(s === "" ? EMPTY_COLUMN : s, 11, "500", vars.colLabel),
	);
	const rowL: TextNode[] = plan.matrix.rows.map((s) =>
		label(s, 12, "600", vars.rowLabel),
	);
	const colW = Array.from({ length: ncol }, (_, j) =>
		Math.max(...grid.map((r) => r[j]?.width ?? 0), colL[j]?.width ?? 0),
	);
	const rowH = grid.map((r) => Math.max(0, ...r.map((c) => c.height)));
	let y = PAD;
	for (const [i, row] of grid.entries()) {
		let x = PAD;
		for (const [j, c] of row.entries()) {
			c.x = x + ((colW[j] ?? 0) - c.width) / 2;
			c.y = y + (top ? 0 : ((rowH[i] ?? 0) - c.height) / 2);
			x += (colW[j] ?? 0) + GAP;
		}
		y += (rowH[i] ?? 0) + GAP;
	}
	// H13 (sin verificar): el set no se reajusta solo al mover una variante
	set.resizeWithoutConstraints(
		PAD * 2 + colW.reduce((a, b) => a + b, 0) + GAP * (ncol - 1),
		y - GAP + PAD,
	);
	set.cornerRadius = 16;
	setPaints(set, "strokes", [{ bind: vars.stroke, opacity: 1 }], {
		track: false,
	});
	set.dashPattern = DASH;
	const offX = Math.max(0, ...rowL.map((t) => t.width)) + LABEL_GAP;
	const offY =
		colL.length > 0 ? Math.max(...colL.map((t) => t.height)) + LABEL_GAP : 0;
	set.x = offX;
	set.y = offY;
	let cx = offX + PAD;
	for (const [j, t] of colL.entries()) {
		t.x = cx + ((colW[j] ?? 0) - t.width) / 2;
		t.y = 0;
		cx += (colW[j] ?? 0) + GAP;
	}
	let ry = offY + PAD;
	for (const [i, t] of rowL.entries()) {
		t.x = 0;
		t.y = ry + (top ? 0 : ((rowH[i] ?? 0) - t.height) / 2);
		ry += (rowH[i] ?? 0) + GAP;
	}
	matrix.resizeWithoutConstraints(offX + set.width, offY + set.height);
	const need = matrix.width + card.paddingLeft + card.paddingRight;
	if (need > card.width) {
		card.resize(need, card.height);
		head.resize(need, head.height);
	}
}
