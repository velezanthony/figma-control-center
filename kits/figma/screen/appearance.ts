// Aspecto de un marco: rellenos (variable o color, degradados), recorte y desplazamiento, bordes por lado, radios,
// opacidad y sombras. Las variables y los estilos
// de efecto salen de map@1.
import { setPaints } from "../paints.ts";
import type { Effect, FrameNode, GradientPaint, Paint } from "../types.ts";
import type { Ctx } from "./ctx.ts";
import type { Gradient, PlanNode, Rgba } from "./types.ts";

const MAX_RADIUS = 9999;
const ZERO4: readonly number[] = [0, 0, 0, 0];

const stops = (g: Gradient) =>
	g.stops.map((st) => ({
		position: st.p,
		color: { r: st.c[0] / 255, g: st.c[1] / 255, b: st.c[2] / 255, a: st.c[3] },
	}));

// linear-gradient de CSS (ángulo en grados, 0 = hacia arriba) → GRADIENT_LINEAR de Figma en el espacio normalizado del marco
export function gradPaint(g: Gradient, w: number, h: number): GradientPaint {
	if (g.radial === true) {
		const R = Math.SQRT1_2;
		return {
			type: "GRADIENT_RADIAL",
			gradientTransform: [
				[0.5 / R, 0, 0.5 - 0.25 / R],
				[0, 0.5 / R, 0.5 - 0.25 / R],
			],
			gradientStops: stops(g),
		};
	}
	const a = (g.angle * Math.PI) / 180;
	const dx = Math.sin(a);
	const dy = -Math.cos(a);
	// longitud de la línea de degradado de CSS
	const L = Math.abs(w * dx) + Math.abs(h * dy);
	const sx = (w / 2 - (dx * L) / 2) / w;
	const sy = (h / 2 - (dy * L) / 2) / h;
	const ex = (w / 2 + (dx * L) / 2) / w;
	const ey = (h / 2 + (dy * L) / 2) / h;
	// matriz que lleva (sx,sy)→(0,0.5) y (ex,ey)→(1,0.5)
	const vx = ex - sx;
	const vy = ey - sy;
	const d2 = vx * vx + vy * vy;
	return {
		type: "GRADIENT_LINEAR",
		gradientTransform: [
			[vx / d2, vy / d2, -(vx * sx + vy * sy) / d2],
			[-vy / d2, vx / d2, 0.5 + (vy * sx - vx * sy) / d2],
		],
		gradientStops: stops(g),
	};
}

// Relleno, recorte, desplazamiento y bordes. Devuelve el color del borde que se pintó (o null): el padding lo necesita
// para contar el borde transparente
export function paintBox(
	ctx: Ctx,
	f: FrameNode,
	n: PlanNode,
	chain: readonly string[],
): Rgba | null {
	const own = chain.slice(0, 1);
	setPaints(f, "fills", n.bg ? [ctx.paint.paint(n.bg, own, "fill")] : [], {
		track: false,
	});
	if (n.grad) f.fills = [...(f.fills as Paint[]), gradPaint(n.grad, n.w, n.h)];
	f.clipsContent = /hidden|auto|scroll|clip/.test(n.ov ?? "");
	// overflow auto/scroll: en el prototipo hace scroll como en la web (el valor llega como «x y», p. ej. «hidden auto»)
	{
		const [ox, oy] = (n.ov ?? "visible")
			.split(" ")
			.map((v, _i, a) => v || (a[0] as string));
		const sx = /auto|scroll/.test(ox as string);
		const sy = /auto|scroll/.test((oy === undefined ? ox : oy) as string);
		if (sx || sy)
			f.overflowDirection = sx && sy ? "BOTH" : sy ? "VERTICAL" : "HORIZONTAL";
	}
	const bw = n.bw ?? ZERO4;
	const bc = bw[0] ? (n.bc ?? n.bcb) : (n.bcb ?? n.bc);
	if (bw.some((x) => x > 0) && bc) {
		setPaints(f, "strokes", [ctx.paint.paint(bc, own, "stroke")], {
			track: false,
		});
		f.strokeAlign = "INSIDE";
		if (bw.every((x) => x === bw[0])) f.strokeWeight = bw[0] as number;
		else {
			f.strokeTopWeight = bw[0] as number;
			f.strokeRightWeight = bw[1] as number;
			f.strokeBottomWeight = bw[2] as number;
			f.strokeLeftWeight = bw[3] as number;
		}
	}
	return bc ?? null;
}

const CORNERS = [
	"topLeftRadius",
	"topRightRadius",
	"bottomLeftRadius",
	"bottomRightRadius",
] as const;

// Radios (la variable por valor exacto; 9999 es el «completo»), opacidad y sombras
export async function paintShape(
	ctx: Ctx,
	f: FrameNode,
	n: PlanNode,
): Promise<void> {
	const rad = (n.rad ?? ZERO4).map((r) => Math.min(r, MAX_RADIUS));
	if (rad.every((r) => r === rad[0])) {
		const r0 = rad[0] as number;
		const rv =
			r0 >= MAX_RADIUS
				? ctx.paint.fullRadius()
				: ctx.paint.numVar("radius", r0);
		f.cornerRadius = r0;
		if (rv && r0 > 0) for (const k of CORNERS) f.setBoundVariable(k, rv);
	} else {
		f.topLeftRadius = rad[0] as number;
		f.topRightRadius = rad[1] as number;
		f.bottomRightRadius = rad[2] as number;
		f.bottomLeftRadius = rad[3] as number;
	}
	if (typeof n.op === "number" && n.op < 1) f.opacity = n.op;
	// la clase manda solo si la sombra calculada se ve (shadow-2xl con un override responsive sale transparente)
	const visible = (n.shs ?? []).filter((e) => e.c[3] > 0);
	const named =
		visible.length > 0 && ctx.effectPattern !== null
			? (n.cls ?? "")
					.split(" ")
					.find(
						(c) => (ctx.effectPattern as RegExp).test(c) && ctx.effects.has(c),
					)
			: undefined;
	if (named !== undefined) {
		await f.setEffectStyleIdAsync(
			(ctx.effects.get(named) as { id: string }).id,
		);
	} else if (visible.length > 0) {
		f.effects = visible
			.map(
				(e): Effect => ({
					type: e.inset ? "INNER_SHADOW" : "DROP_SHADOW",
					color: {
						r: e.c[0] / 255,
						g: e.c[1] / 255,
						b: e.c[2] / 255,
						a: e.c[3],
					},
					offset: { x: e.x, y: e.y },
					radius: e.b,
					spread: e.s,
					visible: true,
					blendMode: "NORMAL",
					...(e.inset ? {} : { showShadowBehindNode: false }),
				}),
			)
			.reverse();
	}
}
