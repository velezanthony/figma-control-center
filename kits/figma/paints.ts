// Pinturas ligadas a variables: `setBoundVariableForPaint` pierde la opacidad, aquí se repone
import { figmaApi, note } from "./core.ts";
import type { SceneNode, Variable } from "./types.ts";

// Una pintura de Figma: solo se toca su opacidad
type OnePaint = { type: string; opacity?: number; [key: string]: unknown };

export type PaintInput = OnePaint | { bind: Variable; opacity?: number };

type Bind = { bind: Variable; opacity?: number };
export const isBind = (p: PaintInput): p is Bind => "bind" in p;

export const toPaint = (input: PaintInput): OnePaint =>
	isBind(input) ? bound(input) : input;

const bound = (input: Bind): OnePaint => {
	const opacity = input.opacity ?? 1;
	const base = { type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity } as const;
	const linked = figmaApi().variables.setBoundVariableForPaint(
		base,
		"color",
		input.bind,
	);
	return { ...linked, opacity } as OnePaint;
};

export function setPaints(
	node: SceneNode,
	field: "fills" | "strokes",
	paints: readonly PaintInput[],
	// Quien pinta cientos de nodos no los quiere todos en `mutatedNodeIds`: declara él lo que le toca
	options: { track?: boolean } = {},
): void {
	const target = node as unknown as Record<string, unknown[]>;
	const wanted = paints.map((paint) =>
		isBind(paint) ? (paint.opacity ?? 1) : null,
	);
	target[field] = paints.map((paint) => (isBind(paint) ? bound(paint) : paint));
	// Medido en Figma real: al asignar una pintura recién ligada, Figma le pone la opacidad a 1. Se relee y, ya ligada, se
	// repone sobre la pintura que devuelve Figma
	const read = target[field] as OnePaint[];
	const fixed = read.map((paint, i) => {
		const opacity = wanted[i];
		return opacity === null ||
			opacity === undefined ||
			paint.opacity === opacity
			? paint
			: ({ ...paint, opacity } as OnePaint);
	});
	if (fixed.some((paint, i) => paint !== read[i])) target[field] = fixed;
	const after = target[field] as OnePaint[];
	for (const [i, opacity] of wanted.entries()) {
		if (opacity !== null && after[i]?.opacity !== opacity) {
			note.warn(
				"OPACITY_LOST",
				`La pintura ${i} de ${field} no conservó su opacidad (${opacity}) al ligarla a una variable.`,
				node.id,
			);
		}
	}
	if (options.track !== false) note.mutated(node);
}
