// Un nodo capturado → su nodo de Figma Recorre el árbol y reparte el trabajo en las piezas de esta carpeta: aspecto, disposición, texto, imagen, svg y correcciones medidas.
import { figmaApi } from "../core.ts";
import type { FrameNode, SceneNode } from "../types.ts";
import { paintBox, paintShape } from "./appearance.ts";
import type { Ctx } from "./ctx.ts";
import { anchorAll, fixPositions, growForAbsolutes } from "./fix-positions.ts";
import { paintImage } from "./image.ts";
import { layerRole } from "./layers.ts";
import {
	childProp,
	configureLayout,
	gridColumns,
	paintOrder,
	placeChild,
	sizeFrame,
} from "./layout.ts";
import { paintIcon, paintSvg } from "./svg.ts";
import { inlineSegments, mergedText, paintText } from "./text.ts";
import type { PlanNode } from "./types.ts";

const CLIPS = /hidden|auto|scroll|clip/;

async function paintKid(
	ctx: Ctx,
	k: PlanNode,
	n: PlanNode,
	chain: readonly string[],
): Promise<SceneNode> {
	if (k.t === "text") return paintText(ctx, k, n, chain);
	return paintNode(ctx, k, chain);
}

// Un nodo capturado → su nodo de Figma: primero lo que el proyecto reconoce como componente (reglas y huellas), si no, el
// nodo pintado por su tipo
export async function paintNode(
	ctx: Ctx,
	k: PlanNode,
	chain: readonly string[],
): Promise<SceneNode> {
	// En una hoja, la raíz de la variante es el propio componente: nunca se reconoce como otro;
	// sus hijos sí
	const sheetRoot =
		ctx.ownTitle !== null &&
		ctx.plan.root.length === 1 &&
		ctx.plan.root[0] === k;
	const made = sheetRoot
		? null
		: ((await ctx.recognizer?.recognize(k, chain)) ?? null);
	if (made !== null) return made;
	if (k.t === "svg") return paintSvg(ctx, k, chain);
	if (k.t === "img") return paintImage(ctx, k);
	if (k.t === "icon") return paintIcon(ctx, k, chain);
	return paintFrame(ctx, k, chain);
}

export async function paintFrame(
	ctx: Ctx,
	n: PlanNode,
	parentChain: readonly string[],
): Promise<FrameNode> {
	const chain = [n.cls ?? "", ...parentChain];
	const f = figmaApi().createFrame();
	ctx.counters.nodes++;
	f.name =
		ctx.layerNames.find((l) => (n.cls ?? "").includes(l.classes))?.name ??
		layerRole(n, ctx.plan.map.layers);
	const bc = paintBox(ctx, f, n, chain);
	await paintShape(ctx, f, n);
	const kids = n.kids ?? [];
	// anclajes de absolutos: se aplican al final, con el tamaño definitivo
	const anchors: [SceneNode, PlanNode][] = [];
	if (kids.length === 0) {
		f.resize(Math.max(n.w, 0.01), Math.max(n.h, 0.01));
		return f;
	}
	const shape = configureLayout(ctx, f, n, kids, bc);
	const segs = inlineSegments(n);
	if (segs) {
		const t = await mergedText(ctx, n, segs, chain);
		f.appendChild(t);
		if (t.textAutoResize === "HEIGHT")
			childProp(ctx, f, t, "layoutAlign", "STRETCH");
	}
	const clips = CLIPS.test(n.ov ?? "");
	if (clips) ctx.clip++;
	const order = segs
		? kids.filter((x) => x.pos === "absolute")
		: shape.flex && /reverse/.test(n.dir ?? "")
			? [...kids].reverse()
			: kids;
	for (const k of order) {
		const c = await paintKid(ctx, k, n, chain);
		f.appendChild(c);
		ctx.km.set(c, k);
		placeChild(ctx, f, c, k, n, shape, anchors);
	}
	if (clips) ctx.clip--;
	if (shape.iwrap) {
		f.primaryAxisSizingMode = "FIXED";
		f.resize(n.w, f.height);
	}
	paintOrder(ctx, f);
	sizeFrame(f, n, shape);
	if (shape.grid) gridColumns(ctx, f, n);
	fixPositions(ctx, f, n, anchors, shape.grid);
	growForAbsolutes(ctx, f, n, kids);
	anchorAll(ctx, anchors, n);
	return f;
}
