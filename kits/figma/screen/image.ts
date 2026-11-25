// Imagen: un rectángulo con la imagen como relleno (FIT o FILL), con sus radios y su opacidad. Una imagen que
// Figma no admite (más de 4096 px por lado, medido en F3) sale como rectángulo sin imagen y con aviso: nunca para la pantalla.
import { figmaApi } from "../core.ts";
import type { RectangleNode } from "../types.ts";
import type { Ctx } from "./ctx.ts";
import type { PlanNode } from "./types.ts";

const MAX_RADIUS = 9999;

export function paintImage(ctx: Ctx, n: PlanNode): RectangleNode {
	const r = figmaApi().createRectangle();
	ctx.counters.nodes++;
	r.name = "imagen";
	r.resize(n.w, n.h);
	const info = n.ref === undefined ? undefined : ctx.plan.images[n.ref];
	if (info === undefined || n.ref === undefined) {
		ctx.warn("IMAGE_MISSING", `La imagen del nodo ${n.id} no está en el plan.`);
	} else if (info.tooLarge === true) {
		ctx.warn(
			"IMAGE_TOO_LARGE",
			`La imagen ${n.ref.slice(0, 8)} (${info.width} × ${info.height}) pasa del tope de Figma: rectángulo sin imagen.`,
		);
	} else {
		const bytes = ctx.assets[info.asset];
		if (bytes === undefined) {
			ctx.warn(
				"IMAGE_MISSING",
				`Falta el asset de la imagen ${n.ref.slice(0, 8)}.`,
			);
		} else {
			try {
				let hash = ctx.hashes.get(n.ref);
				if (hash === undefined) {
					hash = figmaApi().createImage(bytes).hash;
					ctx.hashes.set(n.ref, hash);
				}
				r.fills = [
					{
						type: "IMAGE",
						imageHash: hash,
						scaleMode: n.fit === "contain" ? "FIT" : "FILL",
					},
				];
				ctx.counters.images++;
			} catch (e) {
				ctx.warn(
					"IMAGE_FAILED",
					`Figma no aceptó la imagen ${n.ref.slice(0, 8)}: ${e instanceof Error ? e.message : String(e)}`,
				);
			}
		}
	}
	const rad = (n.rad ?? [0, 0, 0, 0]).map((x) => Math.min(x, MAX_RADIUS));
	r.topLeftRadius = rad[0] as number;
	r.topRightRadius = rad[1] as number;
	r.bottomRightRadius = rad[2] as number;
	r.bottomLeftRadius = rad[3] as number;
	if (typeof n.op === "number" && n.op < 1) r.opacity = n.op;
	return r;
}
