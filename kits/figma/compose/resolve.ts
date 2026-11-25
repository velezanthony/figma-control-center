// Antes de escribir nada: todo lo que el compose nombra (variables, estilos de texto, sets de hojas) se busca en el archivo y,
// si algo falta, se dice todo junto y no se toca el lienzo. Así un paso a medias solo puede venir de una falla de Figma.
import { fail, figmaApi } from "../core.ts";
import { nodeByKey } from "../nodes.ts";
import { loadTokens, type Tokens } from "../tokens.ts";
import {
	type ComponentNode,
	type ComponentSetNode,
	SHEET_KEY_PREFIX,
	type TextStyle,
} from "../types.ts";
import type { BlockData, ComposeParams } from "./types.ts";

export type Resolved = {
	tokens: Tokens;
	textStyles: ReadonlyMap<string, TextStyle>;
	// Clave de la hoja → su set (o componente suelto)
	sets: ReadonlyMap<string, ComponentSetNode | ComponentNode>;
};

type Needs = {
	variables: Set<string>;
	styles: Set<string>;
	sheets: Set<string>;
};

function collect(block: BlockData, needs: Needs): void {
	if ("stack" in block) {
		for (const token of [block.gap, block.fill, block.radius]) {
			if (token !== undefined) needs.variables.add(token);
		}
		const padding =
			typeof block.padding === "string" ? [block.padding] : block.padding;
		for (const token of padding ?? []) needs.variables.add(token);
		for (const child of block.children) collect(child, needs);
	} else if ("text" in block) {
		needs.styles.add(block.style);
		if (block.color !== undefined) needs.variables.add(block.color);
	} else if ("use" in block) {
		if (typeof block.use === "string") needs.sheets.add(block.use);
		for (const children of Object.values(block.slots ?? {})) {
			for (const child of children) collect(child, needs);
		}
	}
}

// Como `norm` de la auditoría vieja: sin mayúsculas ni espacios
const norm = (text: string): string => text.toLowerCase().replace(/\s+/g, "");

// El set de una hoja: el que lleva `fcc:sheet:<clave>` o, si ninguno, el único que se llama como su título
async function findSet(sheet: {
	key: string;
	title: string;
}): Promise<{ set?: ComponentSetNode | ComponentNode; problem?: string }> {
	const byKey = await nodeByKey(`${SHEET_KEY_PREFIX}${sheet.key}`);
	if (
		byKey !== null &&
		(byKey.type === "COMPONENT_SET" || byKey.type === "COMPONENT")
	) {
		return { set: byKey };
	}
	const wanted = norm(sheet.title);
	const found: (ComponentSetNode | ComponentNode)[] = [];
	for (const page of figmaApi().root.children) {
		await page.loadAsync();
		for (const node of page.findAllWithCriteria({
			types: ["COMPONENT_SET", "COMPONENT"],
		})) {
			if (node.parent?.type === "COMPONENT_SET") continue;
			if (norm(node.name) === wanted) found.push(node);
		}
	}
	if (found.length === 1 && found[0] !== undefined) return { set: found[0] };
	return {
		problem:
			found.length === 0
				? `el set de la hoja «${sheet.key}» (por la clave ${SHEET_KEY_PREFIX}${sheet.key} ni por el título «${sheet.title}»)`
				: `un solo set de la hoja «${sheet.key}» (hay ${found.length} llamados «${sheet.title}»)`,
	};
}

export async function resolveNeeds(params: ComposeParams): Promise<Resolved> {
	const needs: Needs = {
		variables: new Set(),
		styles: new Set(),
		sheets: new Set(),
	};
	collect(params.compose.root, needs);

	const missing: string[] = [];
	const tokens = await loadTokens();
	const absent = [...needs.variables].filter(
		(n) => tokens.variable(n) === undefined,
	);
	if (absent.length > 0) {
		missing.push(`las variables ${absent.map((n) => `«${n}»`).join(", ")}`);
	}

	const styles = new Map<string, TextStyle>();
	for (const style of await figmaApi().getLocalTextStylesAsync()) {
		if (!styles.has(style.name)) styles.set(style.name, style);
	}
	const noStyle = [...needs.styles].filter((n) => !styles.has(n));
	if (noStyle.length > 0) {
		missing.push(
			`los estilos de texto ${noStyle.map((n) => `«${n}»`).join(", ")}`,
		);
	}

	const sets = new Map<string, ComponentSetNode | ComponentNode>();
	for (const key of needs.sheets) {
		const sheet = params.sheets.find((s) => s.key === key) ?? {
			key,
			title: key,
		};
		const found = await findSet(sheet);
		if (found.set !== undefined) sets.set(key, found.set);
		else if (found.problem !== undefined) missing.push(found.problem);
	}

	if (missing.length > 0) {
		fail(
			"COMPOSE_NOT_FOUND",
			`En Figma falta: ${missing.join("; ")}.`,
			"Crea lo que falta (o corrige el compose) y repite el paso: no se ha tocado nada. Los sets se crean con kit/build-component@1.",
		);
	}
	return { tokens, textStyles: styles, sets };
}
