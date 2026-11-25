// Disposición de un marco: qué `layoutMode` le toca (filas y celdas
// de tabla, rejilla con salto), el relleno con el borde transparente, `itemSpacing` por `gap`/`rgap` o medido entre hermanos,
// alineaciones, tamaños fijos solo con alto explícito, estirar, crecer y el orden de pintado. Las propiedades de hijo
// (`layoutAlign`, `layoutGrow`, tamaño FILL) solo se ponen si el padre tiene auto-layout: sin él lanzan (trampa 13).
import type { FrameNode, SceneNode, TextNode } from "../types.ts";
import type { Ctx } from "./ctx.ts";
import type { PlanNode, Rgba } from "./types.ts";

const JC: Readonly<Record<string, "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN">> =
	{
		"flex-start": "MIN",
		start: "MIN",
		normal: "MIN",
		center: "CENTER",
		"flex-end": "MAX",
		end: "MAX",
		"space-between": "SPACE_BETWEEN",
	};
const AI: Readonly<Record<string, "MIN" | "CENTER" | "MAX" | "BASELINE">> = {
	"flex-start": "MIN",
	start: "MIN",
	center: "CENTER",
	"flex-end": "MAX",
	end: "MAX",
	baseline: "BASELINE",
	stretch: "MIN",
	normal: "MIN",
};

export type Shape = {
	flex: boolean;
	grid: boolean;
	trow: boolean;
	tgroup: boolean;
	tcell: boolean;
	sameLine: boolean;
	iwrap: boolean;
};

const ZERO4: readonly number[] = [0, 0, 0, 0];
const GROW = /(^| )(flex-1|grow|flex-grow|flex-auto)( |$)/;
const growsOf = (k: PlanNode): boolean =>
	k.fg !== undefined ? k.fg > 0 : GROW.test(k.cls ?? "");
const isAbs = (k: PlanNode): boolean =>
	k.pos === "absolute" || k.pos === "fixed";
const startsInline = (k: PlanNode): boolean =>
	(k.disp ?? "").startsWith("inline");

// El nodo tiene siempre estas medidas
const at = (list: readonly number[] | undefined, i: number): number =>
	(list ?? ZERO4)[i] ?? 0;

// Una propiedad de hijo del auto-layout. layoutGrow y layoutAlign se aceptan aunque el padre no tenga auto-layout (medido en
// archivo de pruebas, trampa 13); solo el tamaño FILL lanza ahí, y el pintor lo pone siempre con padre auto-layout
export function childProp<K extends "layoutAlign" | "layoutGrow">(
	_ctx: Ctx,
	_parent: FrameNode,
	child: SceneNode,
	key: K,
	value: K extends "layoutAlign" ? "STRETCH" | "INHERIT" : number,
): void {
	(child as unknown as Record<string, unknown>)[key] = value;
}

// layoutMode, relleno, separación y alineaciones; devuelve las banderas que usan el resto de pasos
export function configureLayout(
	ctx: Ctx,
	f: FrameNode,
	n: PlanNode,
	kids: readonly PlanNode[],
	bc: Rgba | null,
): Shape {
	const disp = n.disp ?? "";
	const flex = disp.includes("flex");
	const grid = disp.includes("grid");
	// Tablas: fila en horizontal con celdas estiradas al alto; grupos (thead/tbody/table) en vertical; celda centrada
	const trow = disp === "table-row";
	const tgroup =
		/^(table|table-row-group|table-header-group|table-footer-group)$/.test(
			disp,
		);
	const tcell = disp === "table-cell";
	const ta = n.font?.ta;
	const TA = n.font
		? ta === "right" || ta === "end"
			? "MAX"
			: ta === "center"
				? "CENTER"
				: "MIN"
		: undefined;
	const flow = kids.filter((k) => k.pos !== "absolute" && k.y != null);
	const sameLine =
		flow.length < 2 ||
		Math.max(...flow.map((k) => k.y as number)) <
			Math.min(...flow.map((k) => (k.y as number) + k.h)) - 0.5;
	const allInline =
		sameLine &&
		kids.every(
			(k) =>
				k.t === "text" ||
				k.t === "svg" ||
				k.t === "img" ||
				k.t === "icon" ||
				k.pos === "absolute" ||
				k.fl === "left" ||
				startsInline(k),
		);
	// celda con contenido apilado (enlace + div de bloque) → vertical; si no, el de abajo quedaba con hueco fijo
	const tstack = tcell && !sameLine;
	f.layoutMode = tstack
		? "VERTICAL"
		: trow || tcell
			? "HORIZONTAL"
			: tgroup
				? "VERTICAL"
				: grid
					? "HORIZONTAL"
					: flex
						? (n.dir ?? "").startsWith("column")
							? "VERTICAL"
							: "HORIZONTAL"
						: allInline
							? "HORIZONTAL"
							: "VERTICAL";
	f.strokesIncludedInLayout = true;
	const pads = [
		"paddingTop",
		"paddingRight",
		"paddingBottom",
		"paddingLeft",
	] as const;
	// borde transparente (border-2 border-transparent): no se pinta, pero ocupa sitio → se suma al padding
	const transB: readonly number[] = !bc ? (n.bw ?? ZERO4) : ZERO4;
	pads.forEach((k, i) => {
		const v = at(n.pad, i) + (transB[i] ?? 0);
		f[k] = v;
		const sv = !transB[i] && v > 0 && ctx.paint.numVar("spacing", v);
		if (sv) f.setBoundVariable(k, sv);
	});
	const spacing = (g: number) => {
		f.itemSpacing = g;
		const gv = g > 0 && ctx.paint.numVar("spacing", g);
		if (gv) f.setBoundVariable("itemSpacing", gv);
	};
	if (trow || tgroup) {
		f.itemSpacing = 0;
		f.primaryAxisAlignItems = "MIN";
		f.counterAxisAlignItems = "MIN";
	} else if (tstack) {
		f.primaryAxisAlignItems =
			n.va === "top" ? "MIN" : n.va === "bottom" ? "MAX" : "CENTER";
		f.counterAxisAlignItems = TA ?? "MIN";
		f.itemSpacing = 0;
	} else if (tcell) {
		f.counterAxisAlignItems =
			n.va === "top" ? "MIN" : n.va === "bottom" ? "MAX" : "CENTER";
		f.primaryAxisAlignItems = TA ?? "MIN";
	} else if (grid) {
		// CSS grid → fila con wrap a ancho fijo: las celdas (ya a su tamaño) caen en sus columnas; una sola fila en el
		// navegador → sin wrap (una celda 1 px más ancha en Figma no debe tirar la imagen a otra línea)
		const fk = kids.filter((k) => k.pos !== "absolute" && k.pos !== "fixed");
		const first = fk[0] as PlanNode;
		const oneRow =
			fk.length > 1 &&
			fk.every(
				(k) =>
					(k.y as number) < (first.y as number) + first.h &&
					(first.y as number) < (k.y as number) + k.h,
			);
		f.layoutWrap = oneRow ? "NO_WRAP" : "WRAP";
		f.itemSpacing = n.gap ?? 0;
		f.counterAxisSpacing = n.rgap ?? 0;
		f.primaryAxisAlignItems = "MIN";
		// grid: align-items normal = arriba
		f.counterAxisAlignItems = AI[n.ai ?? ""] ?? "MIN";
	} else if (flex) {
		spacing(f.layoutMode === "HORIZONTAL" ? (n.gap ?? 0) : (n.rgap ?? 0));
		f.primaryAxisAlignItems = JC[n.jc ?? ""] ?? "MIN";
		f.counterAxisAlignItems = AI[n.ai ?? ""] ?? "MIN";
		// flex-wrap solo si en el navegador partió línea de verdad (ml-auto + wrap partiría en Figma lo que cabe en una)
		if (n.wrap === "wrap" && !sameLine) {
			f.layoutWrap = "WRAP";
			f.counterAxisSpacing =
				f.layoutMode === "HORIZONTAL" ? (n.rgap ?? 0) : (n.gap ?? 0);
		}
	} else if (allInline) {
		// flujo inline: en fila, a la línea base si mezcla textos de distinto tamaño; el margen izquierdo hace de gap
		const mixed =
			kids.some((k) => k.t === "frame") && kids.some((k) => k.t === "text");
		f.counterAxisAlignItems =
			n.va === "top" ? "MIN" : mixed ? "BASELINE" : "CENTER";
		f.primaryAxisAlignItems = TA ?? "MIN";
		const g = Math.max(0, ...kids.map((k) => Math.max(k.ml ?? 0, k.mr ?? 0)));
		if (g) {
			f.itemSpacing = g;
			const gv = ctx.paint.numVar("spacing", g);
			if (gv) f.setBoundVariable("itemSpacing", gv);
		}
	}
	// Flujo normal (no flex/grid): los márgenes entre hermanos (mb-1, mt-2…) → itemSpacing, medido de las posiciones reales
	if (!flex && !grid && flow.length > 1) {
		const V = f.layoutMode === "VERTICAL";
		const srt = [...flow].sort((a, b) =>
			V ? (a.y as number) - (b.y as number) : (a.x as number) - (b.x as number),
		);
		const gaps = srt
			.slice(1)
			.map((k, i) => {
				const p = srt[i] as PlanNode;
				return Math.round(
					V
						? (k.y as number) - ((p.y as number) + p.h)
						: (k.x as number) - ((p.x as number) + p.w),
				);
			})
			.filter((g) => g > 0);
		// el menor: los huecos mayores salen como «margen» (en flujo); con el mayor, los menores quedaban absolutos
		if (gaps.length > 0) {
			const g = Math.min(...gaps);
			if (g > f.itemSpacing) spacing(g);
		}
	}
	f.primaryAxisSizingMode = grid ? "FIXED" : "AUTO";
	f.counterAxisSizingMode = "AUTO";
	// +1: decimales de las celdas no deben forzar otra línea
	if (grid) f.resize(n.w + (f.layoutWrap === "WRAP" ? 1 : 0), f.height);
	// Inline que parte línea (badge + texto que salta debajo): Figma no empieza un texto a media línea → fila con wrap
	const iwrap =
		!flex &&
		!grid &&
		kids.some(
			(k, i) =>
				i > 0 &&
				k.t === "frame" &&
				startsInline(k) &&
				(k.kids ?? []).some((y) => y.t === "text" && (y.lines ?? 1) > 1) &&
				(k.x as number) <
					((kids[i - 1] as PlanNode).x as number) +
						(kids[i - 1] as PlanNode).w -
						0.5,
		);
	if (iwrap) {
		f.layoutMode = "HORIZONTAL";
		f.layoutWrap = "WRAP";
		f.counterAxisSpacing = 0;
		f.counterAxisAlignItems = "MIN";
		for (const k of kids) k.noPos = true;
	}
	return { flex, grid, trow, tgroup, tcell, sameLine, iwrap };
}

// Lo que un hijo recién añadido necesita de su padre: estirarse, crecer, o salir del flujo si es absoluto
export function placeChild(
	ctx: Ctx,
	f: FrameNode,
	c: SceneNode,
	k: PlanNode,
	n: PlanNode,
	shape: Shape,
	anchors: [SceneNode, PlanNode][],
): void {
	const { flex, grid, trow, tgroup, tcell, iwrap } = shape;
	if ((trow || tgroup) && !isAbs(k))
		childProp(ctx, f, c, "layoutAlign", "STRETCH");
	// CSS: un bloque ocupa todo el ancho de su padre; en flex con align-items stretch (por defecto) los hijos se estiran en
	// el eje cruzado
	const inFlow = !isAbs(k) && k.t === "frame";
	// solo si en el navegador de verdad ocupó todo el hueco del padre (un hijo con alto/ancho propio no se estira)
	const innerW = n.w - at(n.pad, 1) - at(n.pad, 3) - at(n.bw, 1) - at(n.bw, 3);
	const innerH = n.h - at(n.pad, 0) - at(n.pad, 2) - at(n.bw, 0) - at(n.bw, 2);
	const fillsW = Math.abs(k.w - innerW) < 1;
	const fillsH = Math.abs(k.h - innerH) < 1;
	if (
		inFlow &&
		!flex &&
		!grid &&
		!trow &&
		!tcell &&
		f.layoutMode === "VERTICAL" &&
		!startsInline(k) &&
		(!k.fl || k.fl === "none") &&
		fillsW
	)
		childProp(ctx, f, c, "layoutAlign", "STRETCH");
	if (
		inFlow &&
		flex &&
		/^(normal|stretch)$/.test(n.ai ?? "") &&
		(f.layoutMode === "HORIZONTAL" ? fillsH : fillsW) &&
		(k.kids ?? []).length > 0
	)
		childProp(ctx, f, c, "layoutAlign", "STRETCH");
	// flex-1 / grow / flex-auto → rellenar el eje principal del padre flex (si no, lo que va detrás se descoloca); crecer
	// según el flex-grow calculado (ya resuelve lg:flex-none y demás breakpoints)
	if (flex && growsOf(k) && !isAbs(k)) {
		childProp(ctx, f, c, "layoutGrow", 1);
		if (c.type === "TEXT") c.textAutoResize = "HEIGHT";
		// bloque de texto estirado por flex-1: el texto arranca arriba, como en el navegador
		if (
			c.type === "FRAME" &&
			c.layoutMode === "HORIZONTAL" &&
			!/flex/.test(k.disp ?? "")
		)
			c.counterAxisAlignItems = "MIN";
	}
	// …y su texto rellena ese hueco con alto automático: salta de línea al estrechar (también dentro de una instancia)
	if (
		"layoutGrow" in c &&
		c.layoutGrow === 1 &&
		c.type === "FRAME" &&
		f.layoutMode === "HORIZONTAL"
	) {
		for (const tx of c.children.filter(
			(x): x is TextNode => x.type === "TEXT",
		)) {
			if (c.layoutMode === "HORIZONTAL") childProp(ctx, c, tx, "layoutGrow", 1);
			else if (c.layoutMode === "VERTICAL")
				childProp(ctx, c, tx, "layoutAlign", "STRETCH");
			tx.textAutoResize = "HEIGHT";
		}
	}
	if (k.grow) {
		childProp(ctx, f, c, "layoutGrow", 1);
		if (c.type === "TEXT") c.textAutoResize = "HEIGHT";
	}
	// En una hoja, el texto único de un bloque ocupa su ancho como en CSS: la instancia que se estira o cambia de texto parte
	// líneas. Solo en hojas: en una pantalla se queda a su medida
	if (
		ctx.ownTitle !== null &&
		c.type === "TEXT" &&
		c.textTruncation !== "ENDING" &&
		fillsBlock(f, k, n)
	) {
		childProp(ctx, f, c, "layoutGrow", 1);
		c.textAutoResize = "HEIGHT";
	}
	if (isAbs(k)) {
		absolute(ctx, f, c, k);
		anchors.push([c, k]);
	}
	if (
		iwrap &&
		c.type === "FRAME" &&
		(k.kids ?? []).some((y) => y.t === "text" && (y.lines ?? 1) > 1)
	) {
		for (const x of c.findAllWithCriteria({ types: ["TEXT"] }))
			x.textAutoResize = "WIDTH_AND_HEIGHT";
		c.primaryAxisSizingMode = "AUTO";
		c.counterAxisSizingMode = "AUTO";
	}
}

const BLOCK = /^(block|flow-root|list-item)$/;
const FIT = /(^| )(w-fit|w-min|w-max)( |$)/;

// El texto es lo único en flujo de un bloque que no se ajusta a su contenido (w-fit…): en CSS ocupa todo su ancho
function fillsBlock(f: FrameNode, k: PlanNode, n: PlanNode): boolean {
	const flow = (n.kids ?? []).filter((x) => !isAbs(x));
	return (
		k.t === "text" &&
		f.layoutMode === "HORIZONTAL" &&
		flow.length === 1 &&
		BLOCK.test(n.disp ?? "") &&
		!FIT.test(n.cls ?? "")
	);
}

// Un hijo fuera del flujo: `layoutPositioning` antes de `x`/`y` y solo dentro de auto-layout (trampa 15)
export function absolute(
	ctx: Ctx,
	f: FrameNode,
	c: SceneNode,
	k: PlanNode,
): void {
	if (f.layoutMode === "NONE") {
		ctx.warn(
			"LAYOUT_PROP",
			`«${f.name}» no tiene auto-layout: un hijo absoluto no se saca del flujo.`,
			f.id,
		);
	} else {
		try {
			(c as FrameNode).layoutPositioning = "ABSOLUTE";
		} catch (e) {
			ctx.warn(
				"LAYOUT_PROP",
				`No se pudo poner un hijo de «${f.name}» en posición absoluta: ${e instanceof Error ? e.message : String(e)}`,
				c.id,
			);
		}
	}
	c.x = k.x as number;
	c.y = k.y as number;
}

const isPositioned = (k: PlanNode | undefined): boolean =>
	k !== undefined && !!k.pos && k.pos !== "static";

// Orden de pintado CSS: lo posicionado va encima de lo estático (salvo el raster de fondo, que queda al fondo); lo absoluto,
// sobre lo estático pero por debajo de los hermanos posicionados que vienen después en el DOM; z-index negativo debajo de todo
export function paintOrder(ctx: Ctx, f: FrameNode): void {
	const ch0 = [...f.children];
	for (const c of ch0) {
		if (
			!("layoutPositioning" in c) ||
			c.layoutPositioning !== "ABSOLUTE" ||
			c.name === "imagen"
		)
			continue;
		const later = ch0.slice(ch0.indexOf(c) + 1).find((x) => {
			const kx = ctx.km.get(x);
			return (
				isPositioned(kx) &&
				!("layoutPositioning" in x && x.layoutPositioning === "ABSOLUTE")
			);
		});
		// si el navegador lo pintaba encima (elementFromPoint en la captura), va al frente
		if (later && !ctx.km.get(c)?.top)
			f.insertChild(f.children.indexOf(later), c);
		else f.appendChild(c);
	}
	[...f.children]
		.filter((c) => /(^| )-z-/.test(ctx.km.get(c)?.cls ?? ""))
		.reverse()
		.forEach((c) => {
			f.insertChild(0, c);
		});
}

// HUG salvo que el navegador mida distinto (w-full, size-9, min-w…): entonces tamaño fijo; el alto fijo solo si el elemento
// lo declara o no tiene contenido que lo dé
export function sizeFrame(f: FrameNode, n: PlanNode, shape: Shape): void {
	const H = f.layoutMode === "HORIZONTAL";
	// si Figma necesita más ancho por métrica de fuente (Bold mide 1-2 px más), se deja HUG: forzar el del navegador solaparía
	const textual = f.children.some((c) => c.type === "TEXT") && f.width > n.w;
	if (Math.abs(f.width - n.w) > 1.5 && !textual) {
		if (H) f.primaryAxisSizingMode = "FIXED";
		else f.counterAxisSizingMode = "FIXED";
		f.resize(n.w, f.height);
	}
	// …o si no contiene texto: su alto lo da el CSS (pista del toggle, barras, puntos), no un contenido que pueda variar
	const hasText = hasTextNode(n.kids ?? []);
	// inset-0 / fixed / h-screen: ocupan su contenedor o la pantalla (overlay de modal) → alto real
	const explicitH =
		/(^| )(h-|size-|min-h-|max-h-|aspect-|inset-0|inset-y-0)/.test(
			n.cls ?? "",
		) ||
		n.pos === "fixed" ||
		shape.tcell ||
		shape.trow ||
		!hasText ||
		n.tag === "textarea" ||
		// flex con un hijo flex-1: el alto lo reparte el contenedor (si abraza, el flex-1 no tiene nada que llenar)
		(/flex/.test(n.disp ?? "") &&
			(n.dir ?? "").startsWith("column") &&
			(n.kids ?? []).some(growsOf));
	if (
		Math.abs(f.height - n.h) > 1.5 &&
		(explicitH || f.children.length === 0)
	) {
		if (H) f.counterAxisSizingMode = "FIXED";
		else f.primaryAxisSizingMode = "FIXED";
		f.resize(f.width, n.h);
	}
}

const hasTextNode = (nodes: readonly PlanNode[]): boolean =>
	nodes.some((k) => k.t === "text" || hasTextNode(k.kids ?? []));

// celdas de CSS grid: el ancho de la columna lo fija el grid, no el contenido. Columnas iguales (grid-cols-N) → todas al mismo
// ancho exacto
export function gridColumns(ctx: Ctx, f: FrameNode, n: PlanNode): void {
	const inF = f.children.filter(
		(c) =>
			ctx.km.get(c) &&
			!("layoutPositioning" in c && c.layoutPositioning === "ABSOLUTE"),
	);
	const ks = inF.map((c) => ctx.km.get(c) as PlanNode);
	const cols = new Set(ks.map((k) => Math.round(k.x as number))).size;
	const ws = ks.map((k) => k.w);
	// −0,5: la holgura va en las celdas; si el grid pasa a «fill» pierde el +1 del ancho y las columnas exactas saltaban de fila
	if (cols > 1 && Math.max(...ws) - Math.min(...ws) < 2) {
		const cw =
			Math.floor(
				((n.w - at(n.pad, 1) - at(n.pad, 3) - (cols - 1) * (n.gap ?? 0)) /
					cols) *
					100,
			) /
				100 -
			0.5;
		for (const k of ks) k.w = cw;
	} else if (cols > 1) {
		// col-span mezclados: misma holgura en cada celda
		for (const k of ks) k.w -= 0.5;
	}
	for (const c of f.children) {
		const k = ctx.km.get(c);
		if (
			!k ||
			("layoutPositioning" in c && c.layoutPositioning === "ABSOLUTE") ||
			!("resize" in c) ||
			Math.abs(c.width - k.w) <= 0.01
		)
			continue;
		if (c.type === "FRAME") {
			if (c.layoutMode === "HORIZONTAL") c.primaryAxisSizingMode = "FIXED";
			else if (c.layoutMode === "VERTICAL") c.counterAxisSizingMode = "FIXED";
		}
		if (c.type === "TEXT") c.textAutoResize = "HEIGHT";
		c.resize(k.w, c.height);
	}
}
