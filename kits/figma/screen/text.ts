// Texto. Solo
// se escribe lo que difiere del estilo de texto (tocar interlineado, interletraje o mayúsculas lo desengancha) y las familias
// y estilos salen de map@1. Todas las fuentes ya están cargadas (createTextKit).
import { figmaApi } from "../core.ts";
import { setPaints, toPaint } from "../paints.ts";
import type { Paint, TextNode } from "../types.ts";
import type { Ctx } from "./ctx.ts";
import type { Font, PlanNode } from "./types.ts";

export type Seg = { txt: string; font: Font };

const px = (value: number) => ({ unit: "PIXELS", value }) as const;
const ZERO4: readonly [number, number, number, number] = [0, 0, 0, 0];

const inlineOf = (x: PlanNode) =>
	(x.disp ?? "").startsWith("inline") &&
	(x.kids ?? []).length > 0 &&
	(x.kids ?? []).every((y) => y.t === "text");

// Párrafo con estilos mezclados (<strong>, <span class="font-semibold">…) → un solo texto con rangos: parte líneas como el
// navegador
export function inlineSegments(n: PlanNode): Seg[] | null {
	if (n.t !== "frame" || /flex|grid/.test(n.disp ?? "")) return null;
	const k = (n.kids ?? []).filter((x) => x.pos !== "absolute");
	// (un <br> también es frame: cuenta como trozo)
	if (k.length === 0 || !k.some((x) => x.t === "frame")) return null;
	const plain = (x: PlanNode) =>
		x.t === "frame" &&
		!x.ml &&
		!x.bg &&
		!(x.bw ?? []).some((b) => b > 0) &&
		(x.pad ?? []).every((p) => p === 0) &&
		inlineOf(x);
	const br = (x: PlanNode) => x.t === "frame" && x.tag === "br";
	if (!k.every((x) => x.t === "text" || plain(x) || br(x))) return null;
	const own = n.font as Font;
	return k.flatMap((x): Seg[] =>
		x.t === "text"
			? [{ txt: x.txt ?? "", font: x.font ?? own }]
			: br(x)
				? [{ txt: "\n", font: own }]
				: (x.kids ?? []).map((y) => ({
						txt: y.txt ?? "",
						font: y.font ?? (x.font as Font),
					})),
	);
}

// Un texto con tramos: cada uno con su letra, tamaño, color y decoración
export function applySegs(
	ctx: Ctx,
	t: TextNode,
	segs: readonly Seg[],
	chain: readonly string[],
): void {
	t.characters = segs.map((s) => s.txt).join("");
	let i = 0;
	for (const sg of segs) {
		const j = i + sg.txt.length;
		if (j === i) continue;
		const f = sg.font;
		t.setRangeFontName(i, j, {
			family: ctx.text.family(f.fam),
			style: ctx.text.style(f.weight),
		});
		t.setRangeFontSize(i, j, f.size);
		if (f.color !== null) {
			t.setRangeFills(i, j, [
				toPaint(ctx.paint.paint(f.color, chain, "text")) as unknown as Paint,
			]);
		}
		if (f.td?.includes("underline"))
			t.setRangeTextDecoration(i, j, "UNDERLINE");
		else if (f.td?.includes("line-through"))
			t.setRangeTextDecoration(i, j, "STRIKETHROUGH");
		i = j;
	}
}

// Cada párrafo con estilos mezclados que hay dentro de un nodo (los de una instancia con «texto enriquecido»)
export function mergedLists(n: PlanNode): Seg[][] {
	const out: Seg[][] = [];
	const rec = (x: PlanNode): void => {
		const segs = inlineSegments(x);
		if (segs) out.push(segs);
		else for (const k of x.kids ?? []) rec(k);
	};
	rec(n);
	return out;
}

// La fuente estática de Figma es algo más ancha que la variable de la web: mismas líneas apretando el interletraje
function fitLines(t: TextNode, lines: number, lhPx: number): void {
	if (!(lines >= 1) || t.textAutoResize !== "HEIGHT" || !(lhPx > 0)) return;
	const ls = t.letterSpacing;
	const base = typeof ls === "object" && ls.unit === "PIXELS" ? ls.value : 0;
	for (let k = 1; k <= 5 && Math.round(t.height / lhPx) > lines; k++) {
		t.letterSpacing = px(base - 0.1 * k);
	}
}

const textAlign = (ta: string): "CENTER" | "RIGHT" | "LEFT" =>
	ta === "center"
		? "CENTER"
		: ta === "right" || ta === "end"
			? "RIGHT"
			: "LEFT";

export async function mergedText(
	ctx: Ctx,
	n: PlanNode,
	segs: readonly Seg[],
	chain: readonly string[],
): Promise<TextNode> {
	const t = figmaApi().createText();
	ctx.counters.nodes++;
	t.name = "texto enriquecido";
	const f = n.font as Font;
	const style = ctx.text.style(f.weight);
	const family = ctx.text.family(undefined);
	t.fontName = { family, style };
	t.characters = "x";
	t.fontSize = f.size;
	const ts = ctx.text.textStyle(family, f.size, style);
	if (ts !== undefined) await t.setTextStyleIdAsync(ts.id);
	const lh = Number.parseFloat(f.lh);
	if (!Number.isNaN(lh)) t.lineHeight = px(lh);
	applySegs(ctx, t, segs, chain);
	t.textAlignHorizontal = textAlign(f.ta);
	const pad = n.pad ?? ZERO4;
	const bw = n.bw ?? ZERO4;
	const inner =
		n.w - (pad[1] ?? 0) - (pad[3] ?? 0) - (bw[1] ?? 0) - (bw[3] ?? 0);
	if (n.h > (Number.isNaN(lh) ? f.size * 1.4 : lh) * 1.4) {
		t.textAutoResize = "HEIGHT";
		t.resize(Math.max(1, inner), t.height);
	} else t.textAutoResize = "WIDTH_AND_HEIGHT";
	if (!Number.isNaN(lh)) {
		fitLines(
			t,
			Math.round(
				(n.h - (pad[0] ?? 0) - (pad[2] ?? 0) - (bw[0] ?? 0) - (bw[2] ?? 0)) /
					lh,
			),
			lh,
		);
	}
	return t;
}

export async function paintText(
	ctx: Ctx,
	n: PlanNode,
	parent: PlanNode,
	chain: readonly string[],
): Promise<TextNode> {
	const f = (n.font ?? parent.font) as Font;
	const t = figmaApi().createText();
	ctx.counters.nodes++;
	const base = ctx.text.style(f.weight);
	const name = ctx.text.fontName(f);
	const strict = ctx.text.isStrict(name.family);
	t.fontName = name;
	t.characters = n.txt ?? "";
	t.fontSize = f.size;
	const ts = strict
		? ctx.text.strictStyle(name.family, f, base)
		: ctx.text.textStyle(name.family, f.size, base);
	if (ts !== undefined) await t.setTextStyleIdAsync(ts.id);
	else
		ctx.warn(
			"TEXT_STYLE_MISSING",
			`No hay estilo de texto local para ${name.family} ${f.size}/${base}${strict ? " (con su interlineado, interletraje y mayúsculas)" : ""}.`,
		);
	// el estilo de texto no trae la cursiva
	if (f.fs === "italic") t.fontName = name;
	const lh = Number.parseFloat(f.lh);
	if (
		!Number.isNaN(lh) &&
		!(
			ts !== undefined &&
			ts.lineHeight.unit === "PIXELS" &&
			Math.abs(ts.lineHeight.value - lh) < 0.01
		)
	)
		t.lineHeight = px(lh);
	// si el estilo ya trae el interletraje o las mayúsculas, no se vuelven a poner (tocar la propiedad desengancha el estilo)
	const sameLs =
		ts !== undefined &&
		ts.letterSpacing.unit === "PIXELS" &&
		Math.abs(ts.letterSpacing.value - (Number.parseFloat(f.ls) || 0)) < 0.01;
	if (f.ls !== "normal" && Number.parseFloat(f.ls) && !sameLs)
		t.letterSpacing = px(Number.parseFloat(f.ls));
	const tc =
		f.tt === "uppercase" ? "UPPER" : f.tt === "capitalize" ? "TITLE" : null;
	if (tc !== null && !(ts !== undefined && ts.textCase === tc)) t.textCase = tc;
	if (f.td?.includes("underline")) t.textDecoration = "UNDERLINE";
	else if (f.td?.includes("line-through")) t.textDecoration = "STRIKETHROUGH";
	if (f.color !== null)
		setPaints(t, "fills", [ctx.paint.paint(f.color, chain, "text")], {
			track: false,
		});
	t.textAlignHorizontal = textAlign(f.ta);
	// el corte de línea lo decide el contenedor: si el texto es su único hijo, ancho interior del padre
	const only = (parent.kids ?? []).length === 1;
	const ppad = parent.pad ?? ZERO4;
	const pbw = parent.bw ?? ZERO4;
	const piw =
		parent.w - (ppad[1] ?? 0) - (ppad[3] ?? 0) - (pbw[1] ?? 0) - (pbw[3] ?? 0);
	const lines = n.lines ?? 1;
	if (lines > 1) {
		t.textAutoResize = "HEIGHT";
		t.resize(Math.ceil(only && piw > n.w ? piw : n.w) + 1, t.height);
		fitLines(t, lines, Number.isNaN(lh) ? t.height / lines : lh);
	} else t.textAutoResize = "WIDTH_AND_HEIGHT";
	// truncate (una línea + «…»): ancho del contenedor, no el del texto entero
	if (/(^| )truncate( |$)/.test(parent.cls ?? "")) {
		const iw = parent.w - (ppad[1] ?? 0) - (ppad[3] ?? 0);
		if (t.width > iw + 0.5) {
			t.textAutoResize = "HEIGHT";
			t.resize(Math.max(1, iw), t.height);
			t.maxLines = 1;
			t.textTruncation = "ENDING";
		}
	}
	return t;
}
