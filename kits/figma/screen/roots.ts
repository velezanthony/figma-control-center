// Las raíces de la pantalla: una sola frame es el propio marco; varias apiladas a x=0 con el mismo ancho,
// un marco vertical (con el fondo de map@1) que fija lo `sticky` y `fixed`; si no, cada una en su posición real.
import { figmaApi } from "../core.ts";
import { setPaints } from "../paints.ts";
import type { FrameNode, SceneNode } from "../types.ts";
import type { Ctx } from "./ctx.ts";
import { paintNode } from "./frame.ts";
import { paintImage } from "./image.ts";
import { paintSvg } from "./svg.ts";
import type { PlanNode } from "./types.ts";

const WIDTH_TOLERANCE = 1;
const STACK_TOLERANCE = 1.5;

type Scroll = "FIXED" | "STICKY_SCROLLS";

// `scrollBehavior` solo se conserva en un hijo de un marco sin auto-layout o según el nodo: si no se queda, aviso (trampa 14)
function scrolls(ctx: Ctx, c: SceneNode, n: PlanNode): void {
	const wanted: Scroll = n.pos === "fixed" ? "FIXED" : "STICKY_SCROLLS";
	const node = c as unknown as { scrollBehavior: string };
	try {
		node.scrollBehavior = wanted;
	} catch (e) {
		ctx.warn(
			"SCROLL_BEHAVIOR",
			`No se pudo fijar el desplazamiento de «${c.name}»: ${e instanceof Error ? e.message : String(e)}`,
			c.id,
		);
		return;
	}
	if (node.scrollBehavior !== wanted) {
		ctx.warn(
			"SCROLL_BEHAVIOR",
			`«${c.name}» no conservó el desplazamiento ${wanted} (se lee ${node.scrollBehavior}).`,
			c.id,
		);
	}
}

const isStack = (flow: readonly PlanNode[]): boolean => {
	const sorted = [...flow].sort((a, b) => (a.y as number) - (b.y as number));
	const first = sorted[0] as PlanNode;
	// un solo nodo es trivialmente una pila: con un overlay fixed al lado (botón + modal) recortaba el overlay
	return (
		sorted.length > 1 &&
		sorted.every((n, i) => {
			if (Math.abs(n.x as number) >= WIDTH_TOLERANCE) return false;
			if (Math.abs(n.w - first.w) >= WIDTH_TOLERANCE) return false;
			const prev = sorted[i - 1];
			return prev === undefined
				? Math.abs(n.y as number) < WIDTH_TOLERANCE
				: Math.abs((n.y as number) - ((prev.y as number) + prev.h)) <
						STACK_TOLERANCE;
		})
	);
};

export async function paintRoots(ctx: Ctx): Promise<SceneNode> {
	const nodes = ctx.plan.root;
	const only = nodes[0];
	if (nodes.length === 1 && only !== undefined && only.t === "frame") {
		return paintNode(ctx, only, []);
	}
	const f = figmaApi();
	const root = f.createFrame();
	ctx.counters.nodes++;
	if (nodes.length === 1 && only !== undefined) {
		root.fills = [];
		root.layoutMode = "HORIZONTAL";
		root.primaryAxisSizingMode = "AUTO";
		root.counterAxisSizingMode = "AUTO";
		root.appendChild(
			only.t === "svg"
				? paintSvg(ctx, only, [only.cls ?? ""])
				: paintImage(ctx, only),
		);
		return root;
	}
	const flow = nodes.filter((n) => n.pos !== "fixed");
	if (flow.length > 0 && isStack(flow)) {
		// Página: header / main / footer apilados como en el body → auto-layout vertical a todo el ancho; lo sticky queda fijo
		const background = ctx.plan.map.screen?.background;
		const variable =
			background === undefined ? undefined : ctx.paint.byName(background);
		if (background !== undefined && variable === undefined) {
			ctx.warn(
				"BACKGROUND_NOT_FOUND",
				`La variable de fondo «${background}» no existe: el marco queda sin relleno.`,
			);
		}
		setPaints(
			root,
			"fills",
			variable === undefined ? [] : [{ bind: variable, opacity: 1 }],
			{ track: false },
		);
		root.clipsContent = true;
		root.layoutMode = "VERTICAL";
		root.primaryAxisSizingMode = "AUTO";
		root.counterAxisSizingMode = "FIXED";
		root.resize((nodes[0] as PlanNode).w, 100);
		for (const n of [...flow].sort(
			(a, b) => (a.y as number) - (b.y as number),
		)) {
			const c = await paintNode(ctx, n, []);
			root.appendChild(c);
			(c as FrameNode).layoutAlign = "STRETCH";
			if (n.pos === "sticky" || n.pos === "fixed") scrolls(ctx, c, n);
		}
		// overlays fixed (modal abierto): encima de la página, en su posición de la ventana
		for (const n of nodes.filter((x) => x.pos === "fixed")) {
			const c = await paintNode(ctx, n, []);
			root.appendChild(c);
			(c as FrameNode).layoutPositioning = "ABSOLUTE";
			c.x = n.x as number;
			c.y = n.y as number;
		}
		return root;
	}
	// Varias raíces (p. ej. un tooltip teleportado a body): se colocan en su posición real
	root.fills = [];
	root.clipsContent = false;
	const x0 = Math.min(...nodes.map((n) => n.x as number));
	const y0 = Math.min(...nodes.map((n) => n.y as number));
	const x1 = Math.max(...nodes.map((n) => (n.x as number) + n.w));
	const y1 = Math.max(...nodes.map((n) => (n.y as number) + n.h));
	root.resize(x1 - x0, y1 - y0);
	for (const n of nodes) {
		const c = await paintNode(ctx, n, []);
		root.appendChild(c);
		c.x = (n.x as number) - x0;
		c.y = (n.y as number) - y0;
	}
	return root;
}
