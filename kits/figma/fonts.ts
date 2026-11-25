// Fuentes: se carga lo que falte, todo junto, antes de tocar `characters`
import { fail, figmaApi, stateOf } from "./core.ts";
import type { SceneNode } from "./types.ts";

type FontName = { family: string; style: string };

// Figma a veces rechaza con un valor que no es un Error: el mensaje lleva su contenido, nunca «[object Object]»
export const reasonOf = (e: unknown): string =>
	e instanceof Error
		? e.message
		: typeof e === "string"
			? e
			: (JSON.stringify(e) ?? String(e));

const fontKey = (f: FontName) => `${f.family}\u0000${f.style}`;

const textsOf = (nodes: readonly SceneNode[]) => {
	const out: SceneNode[] = [];
	for (const node of nodes) {
		if (node.type === "TEXT") out.push(node);
		else if ("findAllWithCriteria" in node) {
			out.push(...node.findAllWithCriteria({ types: ["TEXT"] }));
		}
	}
	return out;
};

const fontsOf = (text: SceneNode): FontName[] => {
	if (text.type !== "TEXT") return [];
	if (text.fontName !== figmaApi().mixed) return [text.fontName];
	return text
		.getStyledTextSegments(["fontName"])
		.map((segment) => segment.fontName);
};

// Carga estas fuentes (las que falten). Una que no existe para el paso con FONT_MISSING; con `optional`, no lanza y devuelve
// las que no se pudieron cargar
export async function loadFonts(
	fonts: readonly FontName[],
	options: { optional?: boolean } = {},
): Promise<FontName[]> {
	const loaded = stateOf().fonts;
	const missing: FontName[] = [];
	// A Figma solo le llega `{ family, style }` (la cursiva va dentro de `style`): una clave de más lanza
	const unique = new Map(
		fonts.map((f): [string, FontName] => [
			fontKey(f),
			{ family: f.family, style: f.style },
		]),
	);
	await Promise.all(
		[...unique]
			.filter(([key]) => !loaded.has(key))
			.map(async ([key, font]) => {
				try {
					await figmaApi().loadFontAsync(font);
					loaded.add(key);
				} catch (e) {
					if (options.optional === true) {
						missing.push(font);
						return;
					}
					fail(
						"FONT_MISSING",
						`No se pudo cargar la fuente ${font.family} ${font.style}: ${reasonOf(e)}`,
						"Comprueba que la fuente está disponible en el archivo (o cambia la del texto) y repite el paso.",
					);
				}
			}),
	);
	return missing;
}

export async function ensureFonts(
	nodes: SceneNode | readonly SceneNode[],
): Promise<void> {
	const loaded = stateOf().fonts;
	const wanted = new Map<string, FontName>();
	for (const text of textsOf(
		Array.isArray(nodes) ? nodes : [nodes as SceneNode],
	)) {
		for (const font of fontsOf(text)) wanted.set(fontKey(font), font);
	}
	await Promise.all(
		[...wanted]
			.filter(([key]) => !loaded.has(key))
			.map(async ([key, font]) => {
				try {
					await figmaApi().loadFontAsync(font);
				} catch (e) {
					fail(
						"FONT_MISSING",
						`No se pudo cargar la fuente ${font.family} ${font.style}: ${reasonOf(e)}`,
						"Comprueba que la fuente está disponible en el archivo (o cambia la del texto) y repite el paso.",
					);
				}
				loaded.add(key);
			}),
	);
}
