// Repintar un icono ya instanciado con el color capturado: los trazos de toda capa que los tenga y los rellenos de los vectores.
// El icono nuevo llega de un swap con su color por defecto; el color real (rojo del aviso, blanco del botón primario) es el de
// la captura.
import { setPaints } from "../paints.ts";
import type { Ctx } from "../screen/ctx.ts";
import type { Rgba } from "../screen/types.ts";
import { descendantsOfType } from "../tree.ts";
import type { InstanceNode } from "../types.ts";

const STROKE_TYPES = [
	"FRAME",
	"VECTOR",
	"RECTANGLE",
	"ELLIPSE",
	"LINE",
	"POLYGON",
	"STAR",
	"BOOLEAN_OPERATION",
] as const;

type Loose = Record<string, unknown>;
const has = (node: unknown, field: string): boolean => {
	const list = (node as Loose)[field];
	return Array.isArray(list) && list.length > 0;
};

export function recolorIcon(
	ctx: Ctx,
	icon: InstanceNode,
	color: Rgba,
	chain: readonly string[],
): void {
	const paint = ctx.paint.paint(color, chain, "svg");
	for (const k of descendantsOfType(icon, STROKE_TYPES)) {
		if (has(k, "strokes")) setPaints(k, "strokes", [paint], { track: false });
	}
	for (const k of descendantsOfType(icon, ["VECTOR"])) {
		if (has(k, "fills")) setPaints(k, "fills", [paint], { track: false });
	}
}

// Las instancias de icono visibles de un componente (las del catálogo de iconos, por el prefijo de map@1)
export function iconInstances(ctx: Ctx, root: InstanceNode): InstanceNode[] {
	return (
		descendantsOfType(root, ["INSTANCE"]) as unknown as InstanceNode[]
	).filter((x) => x.name.startsWith(ctx.plan.map.icons.prefix) && x.visible);
}
