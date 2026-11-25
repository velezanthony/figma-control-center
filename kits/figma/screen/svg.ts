// Svg e iconos. El icono del catálogo (instancia de su componente, repintada con el color
// capturado) si el plan lo tiene; si no, el svg tal cual con createNodeFromSvg y repintado. Los logos y las ilustraciones
// pasan a `recognize@1` (F4b): aquí son un svg más.
import { figmaApi } from "../core.ts";
import { isBind, type PaintInput, setPaints } from "../paints.ts";
import { descendantsOfType } from "../tree.ts";
import type { FrameNode, InstanceNode, SceneNode } from "../types.ts";
import type { Ctx } from "./ctx.ts";
import type { PlanNode, Rgba } from "./types.ts";

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
const ANY_TYPES = [...STROKE_TYPES, "GROUP", "TEXT"] as const;

type Loose = Record<string, unknown>;
const hex = (r: number, g: number, b: number) =>
	[r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");

// Los trazos de una instancia de icono se repintan con el color capturado
function recolorStrokes(ctx: Ctx, node: InstanceNode, paint: PaintInput): void {
	for (const k of descendantsOfType(node, STROKE_TYPES)) {
		const strokes = (k as unknown as Loose)["strokes"];
		if (Array.isArray(strokes) && strokes.length > 0)
			setPaints(k, "strokes", [paint], { track: false });
	}
	void ctx;
}

const withOpacity = (paint: PaintInput, opacity: number): PaintInput =>
	isBind(paint) ? { bind: paint.bind, opacity } : { ...paint, opacity };

const count = (ctx: Ctx, name: string) => {
	ctx.counters.icons++;
	ctx.counters.components[name] = (ctx.counters.components[name] ?? 0) + 1;
};

export function paintIcon(
	ctx: Ctx,
	n: PlanNode,
	chain: readonly string[],
): SceneNode {
	const component = ctx.icons.get(n.name ?? "");
	if (component === undefined) {
		ctx.warn(
			"ICON_MISSING",
			`No hay icono «${n.name}» en las páginas de iconos.`,
		);
		ctx.counters.nodes++;
		return figmaApi().createFrame();
	}
	const node = component.createInstance();
	ctx.counters.nodes++;
	count(ctx, n.name ?? "");
	node.rescale(n.w / node.width);
	if (n.color)
		recolorStrokes(ctx, node, ctx.paint.paint(n.color, chain, "text"));
	return node;
}

export function paintSvg(
	ctx: Ctx,
	n: PlanNode,
	chain: readonly string[],
): SceneNode {
	const name = n.key === undefined ? undefined : ctx.plan.icons[n.key];
	const col: Rgba | null | undefined = n.color;
	const paint = col ? ctx.paint.paint(col, chain, "svg") : null;
	const component = name === undefined ? undefined : ctx.icons.get(name);
	let node: InstanceNode | FrameNode;
	if (component !== undefined && name !== undefined) {
		node = component.createInstance();
		ctx.counters.nodes++;
		count(ctx, name);
		node.rescale(n.w / node.width);
		if (paint !== null) recolorStrokes(ctx, node, paint);
	} else {
		if (name !== undefined)
			ctx.warn(
				"ICON_MISSING",
				`No hay icono «${name}» en las páginas de iconos: se pinta el svg.`,
			);
		node = figmaApi().createNodeFromSvg(n.svg ?? "");
		ctx.counters.nodes++;
		node.rescale(n.w / node.width);
		node.name = n.spin ? "spinner" : "svg";
		node.fills = [];
		if (col && paint !== null) {
			for (const k of descendantsOfType(node, ANY_TYPES)) {
				for (const prop of ["fills", "strokes"] as const) {
					const list = (k as unknown as Loose)[prop];
					if (!Array.isArray(list) || list.length === 0) continue;
					const painted = list.map(
						(p: {
							type: string;
							color: { r: number; g: number; b: number };
							opacity?: number;
						}): unknown =>
							p.type === "SOLID" &&
							hex(p.color.r * 255, p.color.g * 255, p.color.b * 255) ===
								hex(col[0], col[1], col[2])
								? withOpacity(paint, p.opacity ?? 1)
								: p,
					);
					// las pinturas ya existentes pasan tal cual; las que se repintan, por la variable si la hay
					setPaintsMixed(k, prop, painted);
				}
			}
		}
	}
	if (typeof n.op === "number" && n.op < 1) node.opacity = n.op;
	return node;
}

// Una lista donde unas pinturas son del svg y otras (`bind`) son para ligar: se resuelve cada una
function setPaintsMixed(
	node: SceneNode,
	prop: "fills" | "strokes",
	paints: unknown[],
) {
	setPaints(node, prop, paints as PaintInput[], { track: false });
}
