// Piezas de valores que necesitan el navegador: `color` (pinta el color en un canvas de 1 px y
// lee el RGB exacto), `font`, `measureText` y `lineHeight`. Cada kit las crea sobre su documento (`createValues`).
import { px } from "./parse.ts";
import type { Font, Rgba } from "./types.ts";

export type Values = {
	readonly color: (c: string | null | undefined) => Rgba | null;
	readonly font: (cs: CSSStyleDeclaration, color?: Rgba | null) => Font;
	readonly measureText: (txt: string, cs: CSSStyleDeclaration) => number;
	readonly lineHeight: (cs: CSSStyleDeclaration) => number;
};

export function createValues(doc: Document): Values {
	const cv = doc.createElement("canvas");
	cv.width = cv.height = 1;
	const cx = cv.getContext("2d", {
		willReadFrequently: true,
	}) as CanvasRenderingContext2D;
	const color = (c: string | null | undefined): Rgba | null => {
		if (!c || c === "transparent" || c === "rgba(0, 0, 0, 0)") return null;
		cx.clearRect(0, 0, 1, 1);
		cx.fillStyle = "#000";
		cx.fillStyle = c;
		cx.fillRect(0, 0, 1, 1);
		const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data as unknown as Rgba;
		if (a === 0) return null;
		// alpha real (getImageData premultiplica y redondea): lo sacamos de la cadena si existe
		let alpha = 1;
		const inner = (/\(([^)]*)\)\s*$/.exec(c) || [])[1] || "";
		let am: string | null = null;
		if (inner.includes("/")) am = (inner.split("/").pop() as string).trim();
		else if (inner.split(",").length === 4)
			am = (inner.split(",").pop() as string).trim();
		if (am) alpha = am.endsWith("%") ? parseFloat(am) / 100 : parseFloat(am);
		// con alpha < 1 el canvas desmultiplica con pérdida: re-pintamos opaco para el RGB exacto
		if (alpha < 1) {
			const o = inner.includes("/")
				? c.replace(/\/\s*[\d.]+%?\s*\)$/, ")")
				: c.replace(/^rgba\((.*),[^,]*\)$/, "rgb($1)");
			cx.clearRect(0, 0, 1, 1);
			cx.fillStyle = "#000";
			cx.fillStyle = o;
			cx.fillRect(0, 0, 1, 1);
			const d = cx.getImageData(0, 0, 1, 1).data;
			return [d[0] as number, d[1] as number, d[2] as number, alpha];
		}
		return [r, g, b, alpha];
	};
	const font = (cs: CSSStyleDeclaration, c?: Rgba | null): Font => ({
		fam: cs.fontFamily,
		size: px(cs.fontSize),
		weight: cs.fontWeight,
		lh: cs.lineHeight,
		ls: cs.letterSpacing,
		tt: cs.textTransform,
		td: cs.textDecorationLine,
		fs: cs.fontStyle,
		ta: cs.textAlign,
		ws: cs.whiteSpace,
		color: c === undefined ? color(cs.color) : c,
	});
	const mctx = doc
		.createElement("canvas")
		.getContext("2d") as CanvasRenderingContext2D;
	const measureText = (txt: string, cs: CSSStyleDeclaration): number => {
		mctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
		mctx.letterSpacing =
			cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing;
		return mctx.measureText(txt).width;
	};
	const lineHeight = (cs: CSSStyleDeclaration): number =>
		cs.lineHeight === "normal" ? px(cs.fontSize) * 1.25 : px(cs.lineHeight);
	return { color, font, measureText, lineHeight };
}
