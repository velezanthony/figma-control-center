// Fuentes y estilos de texto del pintor: qué familia y qué estilo de Figma corresponde a una letra capturada, qué estilos de
// texto locales hay y cuáles se cargaron. Todo sale de map@1 (`fonts`), nada está escrito aquí por proyecto.
import { fail, figmaApi, note } from "../core.ts";
import { loadFonts } from "../fonts.ts";
import type { TextStyle } from "../types.ts";
import type { Font, PlanMap, PlanNode, ScreenPlan } from "./types.ts";

type FontMap = PlanMap["fonts"];
type FontName = { family: string; style: string };

export type TextKit = {
	// La familia de Figma de una familia CSS (la primera de `families` que encaja; si ninguna, `default`)
	family(css: string | undefined): string;
	// El estilo de Figma de un peso CSS
	style(weight: string): string;
	// El nombre de fuente completo (con la cursiva si la letra la pide y está cargada)
	fontName(font: Font): FontName;
	// El estilo de texto local de ese tamaño y estilo (familias normales)
	textStyle(family: string, size: number, style: string): TextStyle | undefined;
	// El estilo de texto local de las familias `strict`: exige también interlineado, interletraje y mayúsculas
	strictStyle(family: string, font: Font, style: string): TextStyle | undefined;
	isStrict(family: string): boolean;
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

// Cada letra que pinta la pantalla: la de los marcos que la heredan y la de cada texto
function fontsIn(nodes: readonly PlanNode[], out: Font[] = []): Font[] {
	for (const n of nodes) {
		if (n.font !== undefined) out.push(n.font);
		if (n.kids !== undefined) fontsIn(n.kids, out);
	}
	return out;
}

export async function createTextKit(
	config: FontMap,
	plan: ScreenPlan,
): Promise<TextKit> {
	const families = config.families.map((f) => ({
		pattern: new RegExp(f.match, "i"),
		family: f.family,
	}));
	const strict = new Set(config.strict ?? []);
	const substitute = new Map<string, string>();
	const unavailableItalic = new Set<string>();

	const style = (weight: string) => config.styles[weight] ?? "Regular";
	const italic = (base: string) =>
		base === "Regular"
			? config.italic.suffix
			: `${base} ${config.italic.suffix}`;
	const familyOf = (css: string | undefined): string => {
		const found = families.find((f) => f.pattern.test(css ?? ""));
		const chosen = found?.family ?? config.default;
		return substitute.get(chosen) ?? chosen;
	};

	// Todo lo que la pantalla usa se carga ANTES de escribir un texto: una fuente que falta para el paso sin haber escrito nada
	const wanted = new Map<string, FontName & { italic: boolean }>();
	const need = (family: string, base: string, isItalic: boolean) =>
		wanted.set(`${family}\u0000${base}\u0000${isItalic}`, {
			family,
			style: isItalic ? italic(base) : base,
			italic: isItalic,
		});
	for (const font of fontsIn(plan.root)) {
		const family = (
			families.find((f) => f.pattern.test(font.fam ?? "")) ?? {
				family: config.default,
			}
		).family;
		const base = style(font.weight);
		need(family, base, false);
		if (font.fs === "italic") need(family, base, true);
	}
	const regular = [...wanted.values()].filter((w) => !w.italic);
	try {
		await loadFonts(regular);
	} catch (e) {
		const fallback = config.fallback;
		if (fallback === undefined) throw e;
		// `fonts.fallback`: lo que no está se pinta con la familia de respaldo y se avisa
		for (const w of regular) {
			try {
				await loadFonts([{ family: w.family, style: w.style }]);
			} catch {
				try {
					await loadFonts([{ family: fallback, style: w.style }]);
				} catch {
					return fail(
						"FONT_MISSING",
						`No se pudo cargar ${w.family} ${w.style} ni la familia de respaldo ${fallback}.`,
						"Instala la fuente en Figma o cambia `fonts.fallback` de map@1 y repite el paso.",
					);
				}
				substitute.set(w.family, fallback);
				note.warn(
					"FONT_FALLBACK",
					`${w.family} ${w.style} no está en Figma: se usa ${fallback}.`,
				);
			}
		}
	}
	// La cursiva es opcional: sin ella la letra se pinta recta y se avisa
	const italics = [...wanted.values()].filter((w) => w.italic);
	for (const w of italics) {
		const missing = await loadFonts(
			[{ family: substitute.get(w.family) ?? w.family, style: w.style }],
			{ optional: true },
		);
		if (missing.length > 0) {
			unavailableItalic.add(`${w.family}\u0000${w.style}`);
			note.warn(
				"FONT_ITALIC_MISSING",
				`${w.family} ${w.style} no está en Figma: el texto en cursiva se pinta recto.`,
			);
		}
	}

	// Estilos de texto locales: familias normales por tamaño y estilo; las `strict`, por tamaño, estilo, interlineado,
	// interletraje y mayúsculas (cambiar alguno cambiaría su aspecto)
	const normal = new Map<string, TextStyle>();
	const exact = new Map<string, TextStyle>();
	for (const s of await figmaApi().getLocalTextStylesAsync()) {
		const family = s.fontName.family;
		if (strict.has(family)) {
			if (s.lineHeight.unit === "PIXELS") {
				exact.set(
					[
						family,
						s.fontSize,
						s.fontName.style,
						Math.round(s.lineHeight.value),
						round2(s.letterSpacing.value),
						s.textCase,
					].join("|"),
					s,
				);
			}
		} else normal.set(`${family}|${s.fontSize}|${s.fontName.style}`, s);
	}

	return {
		family: familyOf,
		style,
		isStrict: (family) => strict.has(family),
		fontName(font) {
			const family = familyOf(font.fam);
			const base = style(font.weight);
			if (font.fs !== "italic") return { family, style: base };
			const name = italic(base);
			const original =
				families.find((f) => f.pattern.test(font.fam ?? ""))?.family ??
				config.default;
			return unavailableItalic.has(`${original}\u0000${name}`)
				? { family, style: base }
				: { family, style: name };
		},
		textStyle: (family, size, base) => normal.get(`${family}|${size}|${base}`),
		strictStyle: (family, font, base) =>
			exact.get(
				[
					family,
					font.size,
					base,
					Math.round(Number.parseFloat(font.lh) || 0),
					round2(Number.parseFloat(font.ls) || 0),
					font.tt === "uppercase" ? "UPPER" : "ORIGINAL",
				].join("|"),
			),
	};
}
