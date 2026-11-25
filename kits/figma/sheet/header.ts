// La cabecera y la tarjeta de la hoja: título, descripción, aviso de fallo y línea del código, con las
// variables de `style` (sheets@1) y la familia por defecto de map@1.
import { fail, figmaApi, note } from "../core.ts";
import { loadFonts } from "../fonts.ts";
import { setPaints } from "../paints.ts";
import type { Ctx } from "../screen/ctx.ts";
import type { FrameNode, PageNode, TextNode, Variable } from "../types.ts";
import type { ComponentPlan } from "./types.ts";

// Los pesos que usa la hoja: map@1 dice qué estilo de Figma es cada uno; sin él, los nombres de siempre
const DEFAULT_STYLE: Readonly<Record<string, string>> = {
	"400": "Regular",
	"500": "Medium",
	"600": "SemiBold",
};
export type Weight = "400" | "500" | "600";

export const styleOf = (plan: ComponentPlan, weight: Weight): string =>
	plan.map.fonts.styles[weight] ?? DEFAULT_STYLE[weight] ?? "Regular";

// Las variables de `style`, resueltas ya; las que faltan paran el paso ANTES de escribir nada
export function resolveStyle(ctx: Ctx, plan: ComponentPlan) {
	const { style } = plan;
	const names = [
		style.header.fill,
		style.header.text,
		style.card.fill,
		style.texts.description,
		style.texts.bug,
		style.texts.tag,
		style.texts.rowLabel,
		style.texts.colLabel,
		style.matrix.stroke,
	];
	const missing = [...new Set(names)].filter(
		(name) => ctx.paint.byName(name) === undefined,
	);
	if (missing.length > 0) {
		fail(
			"VARIABLE_NOT_FOUND",
			`Faltan las variables de la hoja: ${missing.map((m) => `«${m}»`).join(", ")}.`,
			"Mira las variables con figma_variables y corrige `style` en sheets.json.",
		);
	}
	const variable = (name: string) => ctx.paint.byName(name) as Variable;
	return {
		headerFill: variable(style.header.fill),
		headerText: variable(style.header.text),
		cardFill: variable(style.card.fill),
		description: variable(style.texts.description),
		bug: variable(style.texts.bug),
		tag: variable(style.texts.tag),
		rowLabel: variable(style.texts.rowLabel),
		colLabel: variable(style.texts.colLabel),
		stroke: variable(style.matrix.stroke),
	};
}

export type StyleVariables = ReturnType<typeof resolveStyle>;

// Las fuentes de la hoja, antes de escribir un texto (FONT_MISSING para el paso)
export async function loadSheetFonts(plan: ComponentPlan): Promise<void> {
	const family = plan.map.fonts.default;
	await loadFonts(
		(["400", "500", "600"] as const).map((w) => ({
			family,
			style: styleOf(plan, w),
		})),
	);
}

// Un texto de la hoja: familia por defecto, el estilo del peso y el relleno ligado a su variable
export function sheetText(
	plan: ComponentPlan,
	chars: string,
	size: number,
	weight: Weight,
	variable: Variable,
): TextNode {
	const t = figmaApi().createText();
	t.fontName = {
		family: plan.map.fonts.default,
		style: styleOf(plan, weight),
	};
	t.characters = chars;
	t.fontSize = size;
	setPaints(t, "fills", [{ bind: variable, opacity: 1 }], { track: false });
	return t;
}

export function paintHeader(
	plan: ComponentPlan,
	vars: StyleVariables,
	page: PageNode,
): { head: FrameNode; card: FrameNode } {
	const f = figmaApi();
	const { sheet, style } = plan;
	const head = f.createFrame();
	head.name = "Header";
	head.resize(1480, 218);
	head.cornerRadius = 24;
	setPaints(head, "fills", [{ bind: vars.headerFill, opacity: 1 }], {
		track: false,
	});
	head.layoutMode = "HORIZONTAL";
	head.primaryAxisSizingMode = "FIXED";
	head.counterAxisSizingMode = "FIXED";
	head.counterAxisAlignItems = "CENTER";
	head.paddingLeft = 80;
	head.appendChild(sheetText(plan, sheet.title, 80, "600", vars.headerText));
	page.appendChild(head);

	const card = f.createFrame();
	card.name = sheet.title;
	card.layoutMode = "VERTICAL";
	card.itemSpacing = 32;
	card.y = 266;
	card.cornerRadius = 24;
	setPaints(card, "fills", [{ bind: vars.cardFill, opacity: 1 }], {
		track: false,
	});
	card.paddingTop = 80;
	card.paddingBottom = 80;
	card.paddingLeft = 80;
	card.paddingRight = 80;
	card.counterAxisSizingMode = "FIXED";
	card.resize(1480, 100);
	card.primaryAxisSizingMode = "AUTO";
	page.appendChild(card);

	const lines: [string, number, Weight, Variable][] = [
		[sheet.description, 16, "400", vars.description],
	];
	if (sheet.bug !== undefined)
		lines.push([`${style.bug?.prefix ?? ""}${sheet.bug}`, 14, "600", vars.bug]);
	if (sheet.tag !== undefined) lines.push([sheet.tag, 14, "500", vars.tag]);
	for (const [chars, size, weight, variable] of lines) {
		const t = sheetText(plan, chars, size, weight, variable);
		card.appendChild(t);
		t.layoutAlign = "STRETCH";
		t.textAutoResize = "HEIGHT";
	}
	note.created([head, card]);
	return { head, card };
}
