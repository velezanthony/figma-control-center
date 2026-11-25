// Decidir, aspecto y contenido: partido en piezas con nombre.
// Las arma `node` (walk.ts). Cada pieza recibe el entorno del kit.
import { gradient, luminance, px, shadows } from "./parse.ts";
import type { Box4, Font, RawNode, Rgba } from "./types.ts";
import type { Values } from "./values.ts";

export type KitEnv = {
	readonly win: Window;
	readonly doc: Document;
	readonly v: Values;
	// Fondos con imagen ya decodificados (los rellena `settle` antes de recorrer)
	readonly bg: Map<Element, HTMLImageElement>;
	// Imágenes a 2× su caja (páginas) en vez de 256 px de lado (componentes)
	readonly imgHi: boolean;
};

const SKIPPED_TAGS = ["SCRIPT", "STYLE", "TEMPLATE", "LINK"];

const FRAME0 = (): RawNode => ({
	t: "frame",
	disp: "block",
	dir: "row",
	wrap: "nowrap",
	jc: "normal",
	ai: "normal",
	gap: 0,
	rgap: 0,
	pad: [0, 0, 0, 0],
	bg: null,
	bw: [0, 0, 0, 0],
	bc: null,
	bcb: null,
	rad: [0, 0, 0, 0],
	sh: "",
	ov: "visible",
	ml: 0,
	cls: "",
	op: 1,
	pos: "static",
	w: 0,
	h: 0,
	kids: [],
});

const radii = (cs: CSSStyleDeclaration): Box4 => [
	px(cs.borderTopLeftRadius),
	px(cs.borderTopRightRadius),
	px(cs.borderBottomRightRadius),
	px(cs.borderBottomLeftRadius),
];

// --- Decidir ---

// ¿Se pinta? display:none o visibility:hidden no (el primer corte de `ser`)
export const isRendered = (cs: CSSStyleDeclaration): boolean =>
	!(cs.display === "none" || cs.visibility === "hidden");

// ¿Se ve, ya con su caja? Contenido de un <details> cerrado, sr-only y lo que está fuera del lienzo, no
export function isVisible(
	el: Element,
	cs: CSSStyleDeclaration,
	r: DOMRect,
	env: KitEnv,
): boolean {
	if (!isRendered(cs)) return false;
	// <details> cerrado: Chrome oculta el contenido (salvo el summary) sin display:none
	const pd = el.parentElement;
	if (
		pd &&
		pd.tagName === "DETAILS" &&
		!(pd as HTMLDetailsElement).open &&
		el.tagName !== "SUMMARY"
	)
		return false;
	if (cs.position === "absolute" && r.width <= 1 && r.height <= 1) return false; // sr-only
	// fuera de lienzo: menú móvil escondido con -translate-x-full → entero fuera de la pantalla, no se ve
	if (
		(cs.position === "fixed" || cs.position === "absolute") &&
		r.width > 0 &&
		(r.right <= 0 || r.left >= env.win.innerWidth)
	)
		return false;
	return true;
}

// La caja de display:contents (no tiene): la que abarca a sus hijos; null si no hay ninguno con tamaño
export function contentsBox(el: Element): {
	readonly children: Element[];
	readonly box: { left: number; top: number; width: number; height: number };
} | null {
	const ch = [...el.children].filter((c) => !SKIPPED_TAGS.includes(c.tagName));
	const rs = ch
		.map((c) => c.getBoundingClientRect())
		.filter((q) => q.width || q.height);
	if (!rs.length) return null;
	const L = Math.min(...rs.map((q) => q.left));
	const T = Math.min(...rs.map((q) => q.top));
	const R = Math.max(...rs.map((q) => q.right));
	const B = Math.max(...rs.map((q) => q.bottom));
	return {
		children: ch,
		box: { left: L, top: T, width: R - L, height: B - T },
	};
}

export const classOf = (el: Element): string =>
	typeof (el as HTMLElement).className === "string"
		? (el as HTMLElement).className.replace(/\s+/g, " ").trim()
		: el.getAttribute("class") || "";

// La caja respecto al padre, etiqueta, clases, posición y opacidad
export function box(
	el: Element,
	cs: CSSStyleDeclaration,
	r: DOMRect,
	parentRect: { left: number; top: number } | null,
): RawNode {
	return {
		t: "frame",
		tag: el.tagName.toLowerCase(),
		cls: classOf(el),
		x: r.left - (parentRect ? parentRect.left : 0),
		y: r.top - (parentRect ? parentRect.top : 0),
		w: r.width,
		h: r.height,
		pos: cs.position,
		op: parseFloat(cs.opacity),
	};
}

// absoluto: ¿lo pinta el navegador por encima de sus hermanos? (z-index/orden reales)
export function onTop(
	el: Element,
	cs: CSSStyleDeclaration,
	r: DOMRect,
	env: KitEnv,
): boolean {
	if (!(cs.position === "absolute" && r.width > 2 && r.height > 2))
		return false;
	const hit = env.doc.elementFromPoint(
		r.left + r.width / 2,
		r.top + r.height / 2,
	);
	return !!(hit && (hit === el || el.contains(hit)));
}

// --- Aspecto ---

export function layout(cs: CSSStyleDeclaration): Partial<RawNode> {
	return {
		disp: cs.display,
		dir: cs.flexDirection,
		wrap: cs.flexWrap,
		jc: cs.justifyContent,
		ai: cs.alignItems,
		gap: px(cs.columnGap) || 0,
		rgap: px(cs.rowGap) || 0,
		pad: [
			px(cs.paddingTop),
			px(cs.paddingRight),
			px(cs.paddingBottom),
			px(cs.paddingLeft),
		],
		fl: cs.cssFloat,
		ov: cs.overflow,
		ml: px(cs.marginLeft),
		va: cs.verticalAlign,
		fg: parseFloat(cs.flexGrow) || 0,
	};
}

export function appearance(
	cs: CSSStyleDeclaration,
	r: DOMRect,
	env: KitEnv,
): Partial<RawNode> {
	const { color, font } = env.v;
	return {
		bg: color(cs.backgroundColor),
		bw: [
			px(cs.borderTopWidth),
			px(cs.borderRightWidth),
			px(cs.borderBottomWidth),
			px(cs.borderLeftWidth),
		],
		bc: color(cs.borderTopColor),
		bcb: color(cs.borderBottomColor),
		rad: radii(cs),
		sh: cs.boxShadow !== "none" ? cs.boxShadow : "",
		shs: shadows(cs.boxShadow, color),
		font: font(cs),
		grad: gradient(cs.backgroundImage, r.width, r.height, color),
	};
}

// --- Contenido ---

// Checkbox/radio nativos (accent-color): los pinta Chrome, no el DOM → se reconstruyen como Chrome los dibuja
export function nativeControl(
	el: HTMLInputElement,
	cs: CSSStyleDeclaration,
	base: RawNode,
	env: KitEnv,
): RawNode {
	const { color, font } = env.v;
	const radio = el.type === "radio";
	const s = base.w;
	const dis = el.disabled;
	const acc = color(
		cs.accentColor === "auto" ? "rgb(0,117,255)" : cs.accentColor,
	) as Rgba;
	const ink: Rgba =
		1.05 / (luminance(acc) + 0.05) < 3 ? [59, 59, 59, 1] : [255, 255, 255, 1];
	const R: Box4 = radio ? [s / 2, s / 2, s / 2, s / 2] : [2.5, 2.5, 2.5, 2.5];
	const f: RawNode = {
		...FRAME0(),
		...base,
		t: "frame",
		tag: radio ? "radio" : "checkbox",
		rad: R,
		font: font(cs),
		kids: [],
	};
	if (!el.checked)
		return {
			...f,
			bg: [255, 255, 255, 1],
			bw: [1, 1, 1, 1],
			bc: dis ? [118, 118, 118, 0.3] : [118, 118, 118, 1],
			bcb: dis ? [118, 118, 118, 0.3] : [118, 118, 118, 1],
		};
	if (!radio) {
		const col = dis ? "rgb(255,255,255)" : `rgb(${ink.slice(0, 3)})`;
		return {
			...f,
			bg: dis ? [232, 232, 232, 1] : acc,
			kids: [
				{
					t: "svg",
					tag: "svg",
					cls: "",
					op: 1,
					pos: "absolute",
					x: 0,
					y: 0,
					w: s,
					h: s,
					key: "",
					color: ink,
					svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.2 6.6 11.2 12.6 4.6" stroke="${col}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
				},
			],
		};
	}
	const dot = (d: number, c: Rgba): RawNode => ({
		...FRAME0(),
		tag: "span",
		pos: "absolute",
		x: (s - d) / 2,
		y: (s - d) / 2,
		w: d,
		h: d,
		bg: c,
		rad: [d / 2, d / 2, d / 2, d / 2],
		font: f.font as Font,
		kids: [],
	});
	return {
		...f,
		bg: dis ? [232, 232, 232, 1] : acc,
		kids: [
			dot(s * 0.8, dis ? [255, 255, 255, 1] : ink),
			dot(s * 0.56, dis ? [232, 232, 232, 1] : acc),
		],
	};
}

// Texto que pinta un control (value/placeholder/opción): no está en el DOM como nodo de texto
export function control(
	el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
	cs: CSSStyleDeclaration,
	tag: string,
	env: KitEnv,
): RawNode[] {
	const { color, font, measureText, lineHeight } = env.v;
	let txt = "";
	let c = color(cs.color);
	const input = el as HTMLInputElement;
	if (tag === "select") {
		const sel = el as HTMLSelectElement;
		const o = sel.options[sel.selectedIndex];
		txt = o ? o.text : "";
	} else if (input.type === "date" || input.type === "month") {
		const v = input.value;
		txt = v
			? v.split("-").reverse().join("/")
			: input.type === "date"
				? "dd/mm/aaaa"
				: "-------- de ----";
	} else if (input.value)
		txt =
			input.type === "password" ? "•".repeat(input.value.length) : input.value;
	else if (input.placeholder) {
		txt = input.placeholder;
		c = color(env.win.getComputedStyle(el, "::placeholder").color);
	}
	if (!txt) return [];
	const inner = el.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight);
	const w = tag === "textarea" ? inner : Math.min(measureText(txt, cs), inner);
	const k: RawNode[] = [
		{
			t: "text",
			txt,
			w,
			h: lineHeight(cs),
			lines: tag === "textarea" ? 2 : 1,
			font: font(cs, c),
		},
	];
	if (input.type === "date" || input.type === "month")
		k.push({
			t: "icon",
			name: "calendar",
			w: 16,
			h: 16,
			color: color(cs.color),
		});
	return k;
}

// ::before / ::after con contenido de texto (o un glifo de FontAwesome, que va como imagen)
export function pseudo(
	el: Element,
	which: "::before" | "::after",
	env: KitEnv,
): RawNode | null {
	const { win } = env;
	const { font, measureText, lineHeight } = env.v;
	const p = win.getComputedStyle(el, which);
	const c = p.content;
	if (!c || c === "none" || c === "normal" || !/^".*"$/.test(c)) return null;
	if (/awesome/i.test(p.fontFamily)) {
		// FontAwesome no existe en Figma: el glifo se pinta con la fuente ya cargada y va como imagen
		const g = c.slice(1, -1);
		const cs2 = win.document.createElement("canvas");
		const x = cs2.getContext("2d") as CanvasRenderingContext2D;
		const f = `${p.fontWeight} ${p.fontSize} ${p.fontFamily}`;
		x.font = f;
		const w = Math.ceil(x.measureText(g).width) || px(p.fontSize);
		const h = Math.ceil(lineHeight(p));
		cs2.width = w * 3;
		cs2.height = h * 3;
		const y = cs2.getContext("2d") as CanvasRenderingContext2D;
		y.scale(3, 3);
		y.font = f;
		y.fillStyle = p.color;
		y.globalAlpha = parseFloat(win.getComputedStyle(el).opacity) || 1;
		y.textBaseline = "middle";
		y.fillText(g, 0, h / 2);
		return {
			t: "img",
			tag: "fa",
			cls: (el as HTMLElement).className || "",
			op: 1,
			pos: "static",
			w,
			h,
			data: cs2.toDataURL("image/png"),
			fit: "fill",
			rad: [0, 0, 0, 0],
			glyph: (g.codePointAt(0) as number).toString(16),
		};
	}
	const txt = c.slice(1, -1).replace(/\\"/g, '"');
	if (!txt.trim()) return null;
	return {
		t: "text",
		txt,
		w: measureText(txt, p),
		h: lineHeight(p),
		lines: 1,
		font: font(p),
		ml: px(p.marginLeft),
		mr: px(p.marginRight),
	};
}

// Viñeta / número de un <li> (::marker no es un nodo) y el ▸/▾ de un <summary>
export function marker(
	el: Element,
	cs: CSSStyleDeclaration,
	r: DOMRect,
	tag: string,
	env: KitEnv,
): { readonly first: RawNode | null; readonly last: RawNode | null } {
	const { win } = env;
	const { font, measureText, lineHeight } = env.v;
	let first: RawNode | null = null;
	let last: RawNode | null = null;
	if (
		cs.display === "list-item" &&
		cs.listStyleType !== "none" &&
		tag === "li"
	) {
		const mk = win.getComputedStyle(el, "::marker");
		const parent = el.parentElement as HTMLElement;
		const ol = parent && parent.tagName === "OL";
		const i =
			[...parent.children].filter((c) => c.tagName === "LI").indexOf(el) +
			(ol ? parseInt(parent.getAttribute("start") as string) || 1 : 1);
		const txt =
			ol || /decimal/.test(cs.listStyleType)
				? `${i}.`
				: cs.listStyleType === "circle"
					? "◦"
					: cs.listStyleType === "square"
						? "▪"
						: "•";
		const f = font(mk);
		const w = measureText(txt, mk);
		first = {
			t: "text",
			txt,
			pos: "absolute",
			x: -(w + px(mk.fontSize) * 0.5),
			y: px(cs.paddingTop),
			w,
			h: lineHeight(cs),
			lines: 1,
			font: { ...f, lh: cs.lineHeight },
		};
	}
	// marcador ▶/▼ del <summary> (::marker no es capturable como texto)
	if (tag === "summary" && cs.display === "list-item") {
		const parent = el.parentElement as HTMLDetailsElement | null;
		const mk = parent && parent.open ? "▾ " : "▸ ";
		last = {
			t: "text",
			txt: mk,
			x: 0,
			y: 0,
			w: measureText(mk, cs),
			h: px(cs.lineHeight) || r.height,
			lines: 1,
		};
	}
	return { first, last };
}

// canvas, vídeo e <img>: el bitmap rasterizado (null si no se puede: roto, sin datos, canvas contaminado)
export function image(
	el: Element,
	cs: CSSStyleDeclaration,
	r: DOMRect,
	base: RawNode,
	tag: string,
	env: KitEnv,
): RawNode | null | undefined {
	const { win } = env;
	if (tag === "canvas") {
		// gráficas (Chart.js, mismo origen): el bitmap tal cual
		const cv = el as HTMLCanvasElement;
		let data: string;
		try {
			data = cv.toDataURL("image/png");
		} catch {
			return null;
		}
		if (!cv.width || !cv.height) return null;
		return {
			...base,
			t: "img",
			tag: "canvas",
			src: "",
			data,
			fit: "fill",
			rad: [0, 0, 0, 0],
		};
	}
	if (tag === "video") {
		const vd = el as HTMLVideoElement;
		if (vd.readyState < 2) return null;
		const c2 = win.document.createElement("canvas");
		const k = Math.min(
			1,
			(2 * Math.max(r.width, r.height)) /
				Math.max(vd.videoWidth, vd.videoHeight, 1),
		);
		c2.width = Math.max(1, Math.round(vd.videoWidth * k));
		c2.height = Math.max(1, Math.round(vd.videoHeight * k));
		let data: string;
		try {
			(c2.getContext("2d") as CanvasRenderingContext2D).drawImage(
				vd,
				0,
				0,
				c2.width,
				c2.height,
			);
			data = c2.toDataURL("image/png");
		} catch {
			return null;
		}
		return {
			...base,
			t: "img",
			tag: "video",
			src: vd.currentSrc || "",
			data,
			fit: cs.objectFit,
			rad: radii(cs),
		};
	}
	if (tag === "img") {
		const im = el as HTMLImageElement;
		if (!im.complete || !im.naturalWidth) return null; // imagen rota (tile de mapa sin red…)
		const lim = env.imgHi ? 2 * Math.max(r.width, r.height, 1) : 256;
		const c2 = win.document.createElement("canvas");
		const k = Math.min(1, lim / Math.max(im.naturalWidth, im.naturalHeight, 1));
		c2.width = Math.max(1, Math.round(im.naturalWidth * k));
		c2.height = Math.max(1, Math.round(im.naturalHeight * k));
		const g2 = c2.getContext("2d") as CanvasRenderingContext2D;
		let data: string;
		try {
			g2.drawImage(im, 0, 0, c2.width, c2.height);
			let opaque = false;
			if (env.imgHi && c2.width * c2.height > 160000) {
				const a = g2.getImageData(0, 0, c2.width, c2.height).data;
				opaque = true;
				for (let i = 3; i < a.length; i += 4 * 97)
					if ((a[i] as number) < 255) {
						opaque = false;
						break;
					}
			}
			data = opaque
				? c2.toDataURL("image/jpeg", 0.85)
				: c2.toDataURL("image/png");
		} catch {
			return null; // canvas contaminado (cross-origin)
		}
		return {
			...base,
			t: "img",
			src: im.getAttribute("src") || "",
			data,
			fit: cs.objectFit,
			rad: radii(cs),
		};
	}
	return undefined;
}

// <svg> en línea con el trazo y relleno de CSS pasados a atributos y currentColor resuelto
export function svg(
	el: Element,
	cs: CSSStyleDeclaration,
	r: DOMRect,
	base: RawNode,
	cls: string,
	env: KitEnv,
): RawNode {
	const { win } = env;
	const color = env.v.color(cs.color);
	const keys = [...el.querySelectorAll("path")]
		.map((p) => p.getAttribute("d"))
		.join("|");
	// trazo/relleno que venga de CSS (p. ej. .ql-stroke de Quill) → atributos, para que Figma lo vea
	const cl = el.cloneNode(true) as Element;
	const src = [el, ...el.querySelectorAll("*")];
	const dst = [cl, ...cl.querySelectorAll("*")];
	src.forEach((o, i) => {
		const c2 = win.getComputedStyle(o);
		if (o === el) return;
		for (const [a, v] of [
			["stroke", c2.stroke],
			["fill", c2.fill],
			["stroke-width", c2.strokeWidth],
			["stroke-linecap", c2.strokeLinecap],
			["stroke-linejoin", c2.strokeLinejoin],
			["opacity", c2.opacity],
		] as const)
			if (v && v !== "normal") (dst[i] as Element).setAttribute(a, v);
	});
	const out = cl.outerHTML.replace(/currentColor/g, cs.color);
	const sw = parseFloat(cs.width) || r.width;
	const sh = parseFloat(cs.height) || r.height;
	// posición desde el centro: si está rotado (animate-spin), el rect crece pero el centro no se mueve
	return {
		...base,
		x: (base.x as number) + (r.width - sw) / 2,
		y: (base.y as number) + (r.height - sh) / 2,
		w: sw,
		h: sh,
		t: "svg",
		svg: out,
		key: keys,
		color,
		spin: /animate-spin/.test(cls),
	};
}

// Triángulo de CSS (caja vacía sin ancho propio y un solo borde de color): se dibuja como polígono
export function cssTriangle(
	el: Element,
	cs: CSSStyleDeclaration,
	r: DOMRect,
	base: RawNode,
	env: KitEnv,
): RawNode | null {
	const { color } = env.v;
	const bwT = px(cs.borderTopWidth);
	const bwB = px(cs.borderBottomWidth);
	const bwL = px(cs.borderLeftWidth);
	const bwR = px(cs.borderRightWidth);
	if (
		!el.children.length &&
		!(el.textContent as string).trim() &&
		Math.abs(r.width - bwL - bwR) < 0.5 &&
		(bwT || bwB) &&
		!color(cs.borderLeftColor) &&
		!color(cs.borderRightColor)
	) {
		const down = !!color(cs.borderTopColor) && bwT > 0;
		const c = down ? cs.borderTopColor : cs.borderBottomColor;
		const W = r.width;
		const Hh = r.height;
		const pts = down
			? `0,0 ${W},0 ${W / 2},${Hh}`
			: `0,${Hh} ${W},${Hh} ${W / 2},0`;
		return {
			...base,
			t: "svg",
			key: "",
			color: color(c),
			svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}"><polygon points="${pts}" fill="${c}"/></svg>`,
		};
	}
	return null;
}

const splitPos = (v: string): string[] => v.match(/calc\([^)]*\)|\S+/g) || [];
const posAxis = (tok: string | undefined, L: number, sz: number): number => {
	if (!tok) return 0;
	const m = /^calc\(([\d.]+)% ([-+]) ([\d.]+)px\)$/.exec(tok);
	if (m)
		return (
			((L - sz) * Number(m[1])) / 100 + (m[2] === "-" ? -1 : 1) * Number(m[3])
		);
	if (tok.endsWith("%")) return ((L - sz) * parseFloat(tok)) / 100;
	return (
		(
			{
				left: 0,
				top: 0,
				center: (L - sz) / 2,
				right: L - sz,
				bottom: L - sz,
			} as Record<string, number>
		)[tok] ?? px(tok)
	);
};

// Fondo con imagen (chevron del select, banderas…) → raster del área del elemento
export function backgroundImage(
	_el: Element,
	cs: CSSStyleDeclaration,
	img: HTMLImageElement,
	w: number,
	h: number,
	env: KitEnv,
): RawNode | null {
	const { doc } = env;
	const S = 2;
	const c = doc.createElement("canvas");
	c.width = Math.max(1, Math.round(w * S));
	c.height = Math.max(1, Math.round(h * S));
	const ctx = c.getContext("2d") as CanvasRenderingContext2D;
	ctx.scale(S, S);
	const bl = px(cs.borderLeftWidth);
	const bt = px(cs.borderTopWidth);
	const L = w - bl - px(cs.borderRightWidth);
	const H = h - bt - px(cs.borderBottomWidth);
	const nw = img.naturalWidth || L;
	const nh = img.naturalHeight || H;
	let sw: number | null = nw;
	let sh: number | null = nh;
	const bs = cs.backgroundSize.split(" ");
	if (bs[0] === "contain" || bs[0] === "cover") {
		const k = (bs[0] === "contain" ? Math.min : Math.max)(L / nw, H / nh);
		sw = nw * k;
		sh = nh * k;
	} else {
		const a = bs[0] as string;
		const b = bs[1] || "auto";
		sw =
			a === "auto" ? null : a.endsWith("%") ? (L * parseFloat(a)) / 100 : px(a);
		sh =
			b === "auto" ? null : b.endsWith("%") ? (H * parseFloat(b)) / 100 : px(b);
		if (sw == null && sh == null) {
			sw = nw;
			sh = nh;
		} else if (sw == null) sw = (nw * (sh as number)) / nh;
		else if (sh == null) sh = (nh * sw) / nw;
	}
	const fw = sw as number;
	const fh = sh as number;
	const [px1, py1] = splitPos(cs.backgroundPosition);
	const ix = bl + posAxis(px1, L, fw);
	const iy = bt + posAxis(py1 || "center", H, fh);
	// icono suelto (chevron, bandera): solo su rectángulo, para que en Figma se ancle a su lado y no se deforme al estirar
	if (/no-repeat/.test(cs.backgroundRepeat) && (fw < L - 1 || fh < H - 1)) {
		const c2 = doc.createElement("canvas");
		c2.width = Math.max(1, Math.round(fw * S));
		c2.height = Math.max(1, Math.round(fh * S));
		try {
			(c2.getContext("2d") as CanvasRenderingContext2D).drawImage(
				img,
				0,
				0,
				c2.width,
				c2.height,
			);
		} catch {
			return null;
		}
		return {
			t: "img",
			tag: "bg",
			cls: "",
			op: 1,
			pos: "absolute",
			x: ix,
			y: iy,
			w: fw,
			h: fh,
			data: c2.toDataURL("image/png"),
			fit: "fill",
			rad: [0, 0, 0, 0],
		};
	}
	try {
		ctx.drawImage(img, ix, iy, fw, fh);
		c.toDataURL();
	} catch {
		return null;
	}
	return {
		t: "img",
		tag: "bg",
		cls: "",
		op: 1,
		pos: "absolute",
		x: 0,
		y: 0,
		w,
		h,
		data: c.toDataURL("image/png"),
		fit: "fill",
		rad: radii(cs),
	};
}

// Los nodos de texto directos de un elemento, con su caja (Range) y el número de líneas
export function text(
	el: Element,
	r: DOMRect,
	cs: CSSStyleDeclaration,
	env: KitEnv,
) {
	const sig = [...el.childNodes].filter(
		(c) =>
			c.nodeType === 1 ||
			(c.nodeType === 3 && (c.textContent as string).trim()),
	);
	const inlineFlow = !/flex|grid/.test(cs.display);
	return (ch: ChildNode): RawNode | null => {
		let txt = (ch.textContent as string).replace(/\s+/g, " ");
		if (!txt.trim()) return null;
		if (!inlineFlow || ch === sig[0]) txt = txt.trimStart();
		if (!inlineFlow || ch === sig[sig.length - 1]) txt = txt.trimEnd();
		const rg = env.doc.createRange();
		rg.selectNodeContents(ch);
		const tr = rg.getBoundingClientRect();
		if (tr.width === 0) return null;
		return {
			t: "text",
			txt,
			x: tr.left - r.left,
			y: tr.top - r.top,
			w: tr.width,
			h: tr.height,
			lines: rg.getClientRects().length,
		};
	};
}

export { FRAME0, SKIPPED_TAGS };
