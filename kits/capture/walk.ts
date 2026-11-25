// Recorrido: `node` arma las piezas de un nodo sin la recursión de fuera,
// `walk` lo aplica a las raíces y `paths` pone a cada nodo su ruta: etiqueta e índice entre hermanos de su etiqueta desde
// la raíz de la variante (`main[0]/div[2]/button[0]`; textos `#text[i]`). El id lo pone el servidor desde la ruta.
import {
	appearance,
	backgroundImage,
	box,
	contentsBox,
	control,
	cssTriangle,
	FRAME0,
	image,
	isRendered,
	isVisible,
	type KitEnv,
	layout,
	marker,
	nativeControl,
	onTop,
	pseudo,
	SKIPPED_TAGS,
	svg,
	text,
} from "./pieces.ts";
import type { RawNode } from "./types.ts";

type ParentRect = { left: number; top: number } | null;

// `ignore`: el gancho del proyecto; true = ni el elemento ni lo de dentro se capturan
export function makeNode(env: KitEnv, ignore: (el: Element) => boolean) {
	const { win } = env;
	const node = (el: Element, parentRect: ParentRect): RawNode | null => {
		if (ignore(el)) return null;
		const cs = win.getComputedStyle(el);
		if (!isRendered(cs)) return null;
		// display: contents no tiene caja: se usa la que abarca a sus hijos (si no, en Figma mide 0)
		if (cs.display === "contents") {
			const c = contentsBox(el);
			if (!c) return null;
			const { box: b, children } = c;
			const className = (el as HTMLElement).className;
			return {
				...FRAME0(),
				tag: el.tagName.toLowerCase(),
				cls: typeof className === "string" ? className : "",
				x: b.left - (parentRect ? parentRect.left : 0),
				y: b.top - (parentRect ? parentRect.top : 0),
				w: b.width,
				h: b.height,
				font: env.v.font(cs),
				kids: children
					.map((ch) => node(ch, b))
					.filter((k): k is RawNode => k !== null),
			};
		}
		const r = el.getBoundingClientRect();
		if (!isVisible(el, cs, r, env)) return null;
		const tag = el.tagName.toLowerCase();
		const base = box(el, cs, r, parentRect);
		if (onTop(el, cs, r, env)) base.top = true;
		const input = el as HTMLInputElement;
		if (
			tag === "input" &&
			(input.type === "checkbox" || input.type === "radio")
		)
			return nativeControl(input, cs, base, env);
		const img = image(el, cs, r, base, tag, env);
		if (img !== undefined) return img;
		if (tag === "svg") return svg(el, cs, r, base, base.cls as string, env);
		const tri = cssTriangle(el, cs, r, base, env);
		if (tri) return tri;
		const n: RawNode = {
			...base,
			t: "frame",
			...layout(cs),
			...appearance(cs, r, env),
			kids: [],
		};
		const kids = n.kids as RawNode[];
		const bgImg = env.bg.get(el);
		if (bgImg) {
			const raster = backgroundImage(el, cs, bgImg, r.width, r.height, env);
			if (raster) kids.push(raster);
		}
		const bef = pseudo(el, "::before", env);
		if (bef) kids.push(bef);
		const marks = marker(el, cs, r, tag, env);
		if (marks.first) kids.unshift(marks.first);
		if (marks.last) kids.push(marks.last);
		if (tag === "input" || tag === "textarea" || tag === "select") {
			kids.push(...control(el as HTMLInputElement, cs, tag, env));
			if (tag === "textarea") n.va = "top";
			if (input.type === "date" || input.type === "month")
				Object.assign(n, {
					disp: "flex",
					dir: "row",
					jc: "space-between",
					ai: "center",
				});
			return n;
		}
		const textOf = text(el, r, cs, env);
		for (const ch of el.childNodes) {
			if (ch.nodeType === 3) {
				const t = textOf(ch);
				if (t) kids.push(t);
			} else if (
				ch.nodeType === 1 &&
				!SKIPPED_TAGS.includes((ch as Element).tagName.toUpperCase())
			) {
				const k = node(ch as Element, r);
				if (k) kids.push(k);
			}
		}
		const aft = pseudo(el, "::after", env);
		if (aft) kids.push(aft);
		return n;
	};
	return node;
}

// Las raíces de una variante: el elemento de `pick`, o los hijos del body que se pintan
export function roots(doc: Document, pick?: string): Element[] {
	if (pick) {
		const el = doc.querySelector(pick);
		return el ? [el] : [];
	}
	return [...doc.body.children].filter(
		(e) => !SKIPPED_TAGS.includes(e.tagName),
	);
}

// Ruta de cada nodo: etiqueta (o `#text`) e índice entre los hermanos de esa etiqueta
export function paths(nodes: RawNode[], prefix = ""): RawNode[] {
	const seen = new Map<string, number>();
	for (const n of nodes) {
		const key = n.t === "text" ? "#text" : (n.tag ?? n.t);
		const i = seen.get(key) ?? 0;
		seen.set(key, i + 1);
		n.path = prefix ? `${prefix}/${key}[${i}]` : `${key}[${i}]`;
		if (n.kids) paths(n.kids, n.path);
	}
	return nodes;
}

export function walk(
	elements: readonly Element[],
	node: (el: Element, parentRect: ParentRect) => RawNode | null,
): RawNode[] {
	return paths(
		elements.map((e) => node(e, null)).filter((n): n is RawNode => n !== null),
	);
}
