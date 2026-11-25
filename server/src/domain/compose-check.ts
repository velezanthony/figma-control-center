// Las reglas de compose@1 que el esquema no ve: la hoja existe, la variante y las
// props existen en su set, cada token es una variable o un estilo del archivo abierto y del tipo que pide su campo, y no
// hay ningún número ni color suelto. Puras: reciben el compose y el catálogo ya leído; cada fallo trae su puntero JSON.
// Dos tiempos: `composeOfflineIssues` no necesita Figma (así un compose roto se rechaza sin tocar la pestaña) y
// `composeCatalogIssues` lo cruza con lo que hay en el archivo.
import type { ComposeBlock, ComposeFile, StackBlock } from "./compose.ts";
import { STACK_DIRECTION } from "./compose.ts";

export type ComposeIssue = {
	readonly pointer: string;
	readonly message: string;
};

// De una hoja de sheets@1, lo que hace falta aquí
export type ComposeSheetRef = { readonly key: string; readonly title: string };

// Lo que el archivo abierto sabe de un set (o de un componente suelto)
export type CatalogSet = {
	readonly name: string;
	// Propiedad de variante → sus opciones
	readonly variants: Readonly<Record<string, readonly string[]>>;
	// Las demás; el nombre puede llevar el sufijo `#id` de Figma
	readonly properties: readonly {
		readonly name: string;
		readonly type: string;
	}[];
};

export type CatalogVariable = {
	readonly name: string;
	readonly collection: string;
	readonly type: string;
};

export type ComposeCatalog = {
	readonly sets: readonly CatalogSet[];
	readonly variables: readonly CatalogVariable[];
	readonly textStyles: readonly string[];
};

export const VARIABLE_TYPE = Object.freeze({
	float: "FLOAT",
	color: "COLOR",
} as const);
const PROPERTY_TYPE = Object.freeze({
	text: "TEXT",
	boolean: "BOOLEAN",
	slot: "SLOT",
} as const);

// Un padding como en CSS: 1 valor (todos), 2 (vertical y horizontal), 3 (arriba, laterales y abajo) o 4 (los cuatro lados)
export const MAX_PADDING_SIDES = 4;

// Lo que parece un valor y no el nombre de un token: un color (`#f60`, `rgb(…)`) o un número con o sin unidad
const RAW_VALUE = [
	/^#[0-9a-f]{3,8}$/i,
	/^(rgb|hsl|hwb)a?\(/i,
	/^-?\d+(\.\d+)?(px|rem|em|pt|%)?$/i,
] as const;
const isRawValue = (token: string): boolean =>
	RAW_VALUE.some((pattern) => pattern.test(token.trim()));

// Como `norm` de la auditoría vieja: sin mayúsculas ni espacios
const norm = (text: string): string => text.toLowerCase().replace(/\s+/g, "");
const baseName = (name: string): string => name.split("#")[0] ?? name;

type Field = "gap" | "padding" | "fill" | "radius" | "color" | "style";
type Visit = (block: ComposeBlock, pointer: string) => readonly ComposeIssue[];

// Recorre el árbol en orden de documento (el bloque, sus hijos, luego los slots) y junta lo que dice `visit` de cada uno
function walk(
	block: ComposeBlock,
	pointer: string,
	visit: Visit,
): ComposeIssue[] {
	const issues = [...visit(block, pointer)];
	if ("stack" in block) {
		block.children.forEach((child, i) => {
			issues.push(...walk(child, `${pointer}/children/${i}`, visit));
		});
	}
	if ("use" in block && block.slots !== undefined) {
		for (const [name, children] of Object.entries(block.slots)) {
			children.forEach((child, i) => {
				issues.push(...walk(child, `${pointer}/slots/${name}/${i}`, visit));
			});
		}
	}
	return issues;
}

// Los tokens de un bloque con su campo y su puntero, en el orden en que se declaran
function tokensOf(
	block: ComposeBlock,
	pointer: string,
): { field: Field; token: string; pointer: string }[] {
	if ("stack" in block) {
		const out: { field: Field; token: string; pointer: string }[] = [];
		if (block.gap !== undefined)
			out.push({ field: "gap", token: block.gap, pointer: `${pointer}/gap` });
		if (typeof block.padding === "string") {
			out.push({
				field: "padding",
				token: block.padding,
				pointer: `${pointer}/padding`,
			});
		} else if (block.padding !== undefined) {
			block.padding.forEach((token, i) => {
				out.push({
					field: "padding",
					token,
					pointer: `${pointer}/padding/${i}`,
				});
			});
		}
		if (block.fill !== undefined)
			out.push({
				field: "fill",
				token: block.fill,
				pointer: `${pointer}/fill`,
			});
		if (block.radius !== undefined)
			out.push({
				field: "radius",
				token: block.radius,
				pointer: `${pointer}/radius`,
			});
		return out;
	}
	if ("text" in block) {
		return [
			{ field: "style", token: block.style, pointer: `${pointer}/style` },
			...(block.color === undefined
				? []
				: [
						{
							field: "color" as const,
							token: block.color,
							pointer: `${pointer}/color`,
						},
					]),
		];
	}
	return [];
}

const stackIssues = (
	block: StackBlock,
	pointer: string,
): readonly ComposeIssue[] => {
	const issues: ComposeIssue[] = [];
	if (block.stack === STACK_DIRECTION.grid) {
		issues.push({
			pointer: `${pointer}/stack`,
			message:
				"la rejilla (GRID) todavía no la pinta kit/compose@1: usa VERTICAL u HORIZONTAL.",
		});
	}
	if (
		Array.isArray(block.padding) &&
		block.padding.length > MAX_PADDING_SIDES
	) {
		issues.push({
			pointer: `${pointer}/padding`,
			message: `un padding lleva de 1 a ${MAX_PADDING_SIDES} valores (como en CSS) y aquí hay ${block.padding.length}.`,
		});
	}
	return issues;
};

// Lo que se comprueba sin Figma
export function composeOfflineIssues(
	compose: ComposeFile,
	sheets: readonly { readonly key: string }[],
): ComposeIssue[] {
	return walk(compose.root, "/root", (block, pointer) => {
		const issues: ComposeIssue[] = [];
		if ("stack" in block) issues.push(...stackIssues(block, pointer));
		for (const t of tokensOf(block, pointer)) {
			if (!isRawValue(t.token)) continue;
			issues.push({
				pointer: t.pointer,
				message: `«${t.token}» es un valor suelto: compose@1 solo admite el nombre de una variable (o de un estilo) del archivo.`,
			});
		}
		if ("use" in block) {
			if (typeof block.use !== "string") {
				issues.push({
					pointer: `${pointer}/use`,
					message: `una pieza de librería (use.key «${block.use.key}») queda fuera de kit/compose@1: usa la clave de una hoja de sheets@1.`,
				});
			} else if (!sheets.some((s) => s.key === block.use)) {
				issues.push({
					pointer: `${pointer}/use`,
					message: `la hoja «${block.use}» no está en sheets@1 (hojas: ${sheets.map((s) => s.key).join(", ")}).`,
				});
			}
		}
		if ("image" in block) {
			issues.push({
				pointer: `${pointer}/image`,
				message:
					"las imágenes todavía no las pinta kit/compose@1: usa una hoja con la imagen o pon la imagen a mano después.",
			});
		}
		if ("icon" in block) {
			issues.push({
				pointer: `${pointer}/icon`,
				message:
					"los iconos sueltos todavía no los pinta kit/compose@1: usa una hoja que ya lleve el icono.",
			});
		}
		return issues;
	});
}

const tokenIssue = (
	t: { field: Field; token: string; pointer: string },
	catalog: ComposeCatalog,
): ComposeIssue | null => {
	if (isRawValue(t.token)) return null;
	if (t.field === "style") {
		return catalog.textStyles.includes(t.token)
			? null
			: {
					pointer: t.pointer,
					message: `el estilo de texto «${t.token}» no existe en el archivo.`,
				};
	}
	const wanted =
		t.field === "fill" || t.field === "color"
			? VARIABLE_TYPE.color
			: VARIABLE_TYPE.float;
	const found = catalog.variables.find(
		(v) => v.name === t.token || `${v.collection}/${v.name}` === t.token,
	);
	if (found === undefined) {
		return {
			pointer: t.pointer,
			message: `la variable «${t.token}» no existe en el archivo.`,
		};
	}
	if (found.type !== wanted) {
		return {
			pointer: t.pointer,
			message: `«${t.token}» es una variable ${found.type} y un ${t.field === "color" ? "color de texto" : t.field} necesita una ${wanted}.`,
		};
	}
	return null;
};

const listed = (names: readonly string[]): string =>
	names.length === 0 ? "ninguna" : names.join(", ");

function useIssues(
	block: Extract<ComposeBlock, { use: unknown }>,
	pointer: string,
	sheets: readonly ComposeSheetRef[],
	catalog: ComposeCatalog,
): ComposeIssue[] {
	if (typeof block.use !== "string") return [];
	const key = block.use;
	const sheet = sheets.find((s) => s.key === key);
	// Una hoja que no está en sheets@1 ya la señala composeOfflineIssues
	if (sheet === undefined) return [];
	const wanted = norm(sheet.title);
	const sets = catalog.sets.filter((s) => norm(s.name) === wanted);
	if (sets.length === 0) {
		return [
			{
				pointer: `${pointer}/use`,
				message: `la hoja «${key}» no tiene set «${sheet.title}» en el archivo: píntala antes con kit/build-component@1.`,
			},
		];
	}
	if (sets.length > 1) {
		return [
			{
				pointer: `${pointer}/use`,
				message: `hay más de un set llamado «${sheet.title}» en el archivo: no se sabe cuál es el de la hoja «${key}».`,
			},
		];
	}
	const set = sets[0] as CatalogSet;
	const issues: ComposeIssue[] = [];
	for (const [prop, option] of Object.entries(block.variant ?? {})) {
		const options = set.variants[prop];
		if (options === undefined) {
			issues.push({
				pointer: `${pointer}/variant/${prop}`,
				message: `«${prop}» no es una propiedad de variante de «${set.name}» (propiedades: ${listed(Object.keys(set.variants))}).`,
			});
		} else if (!options.includes(option)) {
			issues.push({
				pointer: `${pointer}/variant/${prop}`,
				message: `«${option}» no es una opción de «${prop}» en «${set.name}» (opciones: ${listed(options)}).`,
			});
		}
	}
	for (const [name, value] of Object.entries(block.props ?? {})) {
		const at = `${pointer}/props/${name}`;
		const own = set.properties.find((p) => baseName(p.name) === name);
		if (own === undefined) {
			issues.push({
				pointer: at,
				message: `«${name}» no es una propiedad de «${set.name}» (propiedades: ${listed(set.properties.map((p) => baseName(p.name)))}).`,
			});
		} else if (own.type === PROPERTY_TYPE.text && typeof value !== "string") {
			issues.push({
				pointer: at,
				message: `«${name}» es de texto y se le da un ${typeof value}.`,
			});
		} else if (
			own.type === PROPERTY_TYPE.boolean &&
			typeof value !== "boolean"
		) {
			issues.push({
				pointer: at,
				message: `«${name}» es de sí o no (true/false) y se le da un texto.`,
			});
		} else if (
			own.type !== PROPERTY_TYPE.text &&
			own.type !== PROPERTY_TYPE.boolean
		) {
			issues.push({
				pointer: at,
				message: `«${name}» es una propiedad ${own.type}: kit/compose@1 solo da valor a las de texto y de sí o no.`,
			});
		}
	}
	for (const slot of Object.keys(block.slots ?? {})) {
		const has = set.properties.some(
			(p) => p.type === PROPERTY_TYPE.slot && baseName(p.name) === slot,
		);
		if (!has) {
			issues.push({
				pointer: `${pointer}/slots/${slot}`,
				message: `«${set.name}» no tiene un slot «${slot}» (slots: ${listed(set.properties.filter((p) => p.type === PROPERTY_TYPE.slot).map((p) => baseName(p.name)))}).`,
			});
		}
	}
	return issues;
}

// Lo que se comprueba contra el catálogo del archivo abierto
export function composeCatalogIssues(
	compose: ComposeFile,
	sheets: readonly ComposeSheetRef[],
	catalog: ComposeCatalog,
): ComposeIssue[] {
	return walk(compose.root, "/root", (block, pointer) => {
		const issues: ComposeIssue[] = [];
		for (const t of tokensOf(block, pointer)) {
			const issue = tokenIssue(t, catalog);
			if (issue !== null) issues.push(issue);
		}
		if ("use" in block)
			issues.push(...useIssues(block, pointer, sheets, catalog));
		return issues;
	});
}

// Las hojas que usa el compose, cada una una vez y en el orden en que salen
export function composeSheetsUsed(compose: ComposeFile): string[] {
	const used = new Set<string>();
	walk(compose.root, "", (block) => {
		if ("use" in block && typeof block.use === "string") used.add(block.use);
		return [];
	});
	return [...used];
}
