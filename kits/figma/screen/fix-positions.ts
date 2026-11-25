// Correcciones que miden lo que Figma ya maquetó: un hijo que cae
// a más de 1,5 px de su sitio (3 tras un texto) se envuelve en un marco «margen» (con padding) o, si es más, se saca del flujo
// como absoluto; un contenedor transparente crece para incluir a un hijo absoluto que desborda; los absolutos se anclan al final
// con el tamaño definitivo.
import { figmaApi } from "../core.ts";
import type { FrameNode, SceneNode } from "../types.ts";
import type { Ctx } from "./ctx.ts";
import { absolute } from "./layout.ts";
import type { PlanNode } from "./types.ts";

const isAbs = (k: PlanNode): boolean =>
	k.pos === "absolute" || k.pos === "fixed";
const isAbsolute = (c: SceneNode): boolean =>
	"layoutPositioning" in c && c.layoutPositioning === "ABSOLUTE";

type Layout = { layoutAlign: string; layoutGrow: number };
const asLayout = (c: SceneNode): Layout => c as unknown as Layout;

// Absoluto anclado como en CSS: al estirar la instancia (select a ancho completo) la flecha sigue pegada a la derecha
function anchor(ctx: Ctx, c: SceneNode, k: PlanNode, n: PlanNode): void {
	const ax = (pos: number, size: number, full: number) =>
		// padre de tamaño 0 (aside colapsado): no hay nada que estirar ni medio que calcular, se conserva el desfase desde el origen
		full <= 0
			? "MIN"
			: size >= full - 1
				? "STRETCH"
				: Math.abs(pos + size / 2 - full / 2) < 1.5
					? "CENTER"
					: pos + size / 2 > full / 2
						? "MAX"
						: "MIN";
	try {
		(c as FrameNode).constraints = {
			horizontal: ax(k.x as number, k.w, n.w),
			vertical: ax(k.y as number, k.h, n.h),
		};
	} catch (e) {
		ctx.warn(
			"CONSTRAINTS_FAILED",
			`No se pudieron poner las anclas de un hijo absoluto: ${e instanceof Error ? e.message : String(e)}`,
			c.id,
		);
	}
}

// Un hijo (no texto) a más de 1,5 px (3 tras un texto) de donde lo pinta el navegador se corrige. Devuelve cuántos sacó del flujo
export function fixPositions(
	ctx: Ctx,
	f: FrameNode,
	n: PlanNode,
	anchors: [SceneNode, PlanNode][],
	grid: boolean,
): number {
	let moved = 0;
	let afterText = false;
	let pk: PlanNode | null = null;
	let pc: SceneNode | null = null;
	const HZ = f.layoutMode === "HORIZONTAL";
	// grid: las celdas las colocan columnas y salto de línea; medir huecos contra la celda anterior (quizá en otra fila) las sacaba del flujo
	for (const c of grid ? [] : [...f.children]) {
		const k = ctx.km.get(c);
		if (k && k.t === "text") afterText = true;
		if (!k || isAbsolute(c) || isAbs(k)) continue;
		if (k.t === "text" || k.noPos || k.x == null) {
			if (k.x != null) {
				pk = k;
				pc = c;
			}
			continue;
		}
		const tol = afterText ? 3 : 1.5;
		// eje principal: hueco respecto al hermano anterior (un hermano 2 px más corto en Figma no arrastra a los demás); eje
		// cruzado: absoluto
		let dx = k.x - c.x;
		let dy = (k.y as number) - c.y;
		if (pk && pc && HZ)
			dx = k.x - ((pk.x as number) + pk.w) - (c.x - (pc.x + pc.width));
		if (pk && pc && !HZ)
			dy =
				(k.y as number) -
				((pk.y as number) + pk.h) -
				(c.y - (pc.y + pc.height));
		pk = k;
		pc = c;
		if (Math.abs(dx) <= tol && Math.abs(dy) <= tol) continue;
		const tag = `${Object.values(ctx.plan.props).join("/")} ${n.tag}>${k.tag ?? k.t}`;
		if (dx >= -0.5 && dy >= -0.5) {
			// margen (mt-0.5, translate-x-4…) → envoltorio con padding: sigue en auto-layout y editable
			const wr = figmaApi().createFrame();
			ctx.counters.nodes++;
			wr.name = "margen";
			wr.fills = [];
			wr.clipsContent = false;
			f.insertChild(f.children.indexOf(c), wr);
			wr.layoutMode = "HORIZONTAL";
			wr.primaryAxisSizingMode = "AUTO";
			wr.counterAxisSizingMode = "AUTO";
			// un bloque a todo el ancho sigue llenando dentro del envoltorio (si no, se encoge a lo que mida su contenido)
			const fillW = !HZ && asLayout(c).layoutAlign === "STRETCH";
			asLayout(wr).layoutGrow = asLayout(c).layoutGrow;
			asLayout(wr).layoutAlign = asLayout(c).layoutAlign;
			// antes de entrar: en el envoltorio horizontal STRETCH es el otro eje, y un hijo que se ajusta a un contenido que lo
			// rellena tomaría los 100 de alto del envoltorio recién creado (medido: el botón de una línea salía de 100)
			asLayout(c).layoutAlign = "INHERIT";
			wr.appendChild(c as FrameNode);
			asLayout(c).layoutGrow = fillW ? 1 : 0;
			if (c.type === "FRAME" && (k.kids ?? []).length === 0) c.resize(k.w, k.h);
			wr.resize(c.width + Math.max(0, dx), c.height + Math.max(0, dy));
			wr.primaryAxisSizingMode = "AUTO";
			wr.counterAxisSizingMode = "AUTO";
			if (fillW) {
				wr.layoutSizingHorizontal = "FILL";
				(c as FrameNode).layoutSizingHorizontal = "FILL";
			}
			wr.paddingLeft = Math.round(dx * 2) / 2;
			wr.paddingTop = Math.round(dy * 2) / 2;
			ctx.counters.wrapped.push(tag);
			// el siguiente hermano mide su hueco desde el envoltorio, no desde el hijo que lleva dentro
			pc = wr;
		} else if (Math.min(dx, dy) >= -4) {
			// desvío pequeño hacia arriba/izquierda: se acepta
		} else {
			absolute(ctx, f, c, k);
			anchors.push([c, k]);
			moved++;
			ctx.counters.moved.push(tag);
		}
	}
	if (moved) {
		f.primaryAxisSizingMode = "FIXED";
		f.counterAxisSizingMode = "FIXED";
		f.resize(n.w, n.h);
	}
	return moved;
}

// Contenedor transparente con hijo absoluto que desborda (panel de dropdown): crece para que el componente lo incluya
export function growForAbsolutes(
	ctx: Ctx,
	f: FrameNode,
	n: PlanNode,
	kids: readonly PlanNode[],
): void {
	const abs = kids.filter(isAbs);
	const bw = n.bw ?? [0, 0, 0, 0];
	if (abs.length === 0 || n.bg || bw.some((x) => x > 0)) return;
	// dentro de un ancestro que recorta (mapa) no se desplaza: movería esa capa respecto a sus hermanas
	const dx = ctx.clip ? 0 : Math.max(0, ...abs.map((k) => -(k.x as number)));
	if (dx > 0) {
		f.paddingLeft += dx;
		for (const c of f.children) if (isAbsolute(c)) c.x += dx;
		for (const k of abs) k.x = (k.x as number) + dx;
		n.w += dx;
	}
	const mw = Math.max(f.width, ...abs.map((k) => (k.x as number) + k.w));
	const mh = Math.max(f.height, ...abs.map((k) => (k.y as number) + k.h));
	if (mw > f.width + 0.5 || mh > f.height + 0.5) {
		// lo estático (el disparador) se queda arriba a la izquierda, como en el navegador: crecer no lo debe recentrar
		if (f.layoutMode === "HORIZONTAL") {
			if (mh > f.height + 0.5) f.counterAxisAlignItems = "MIN";
			if (mw > f.width + 0.5) f.primaryAxisAlignItems = "MIN";
		} else if (f.layoutMode === "VERTICAL") {
			if (mh > f.height + 0.5) f.primaryAxisAlignItems = "MIN";
			if (mw > f.width + 0.5) f.counterAxisAlignItems = "MIN";
		}
		f.primaryAxisSizingMode = "FIXED";
		f.counterAxisSizingMode = "FIXED";
		f.resize(mw, mh);
	}
}

export function anchorAll(
	ctx: Ctx,
	anchors: readonly [SceneNode, PlanNode][],
	n: PlanNode,
): void {
	for (const [c, k] of anchors) anchor(ctx, c, k, n);
}
