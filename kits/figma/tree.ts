// Recorridos del árbol que comparten las piezas de enlaces, marcos y pasos: la página de un nodo, si cuelga de una
// instancia y el texto visible. Siempre por tipo con findAllWithCriteria (findAll recorre todo y es lento).
import type { PageNode, SceneNode } from "./types.ts";

// Los tipos de nodo que pueden llevar un enlace del prototipo o contener algo que lo lleve
export const LINKABLE_TYPES = [
	"FRAME",
	"INSTANCE",
	"COMPONENT",
	"COMPONENT_SET",
	"GROUP",
	"SECTION",
	"TEXT",
	"RECTANGLE",
	"ELLIPSE",
	"VECTOR",
	"LINE",
	"POLYGON",
	"STAR",
	"BOOLEAN_OPERATION",
] as const;

type Searchable = {
	findAllWithCriteria(criteria: { types: string[] }): SceneNode[];
};

// Los descendientes de esos tipos (no el propio nodo); un nodo sin hijos (un texto) no da ninguno
export function descendantsOfType(
	node: SceneNode,
	types: readonly string[],
): SceneNode[] {
	return "findAllWithCriteria" in node
		? (node as unknown as Searchable).findAllWithCriteria({
				types: [...types],
			})
		: [];
}

export function pageOf(node: SceneNode | PageNode): PageNode | null {
	for (
		let n: { type: string; parent?: unknown } | null = node;
		n !== null && n !== undefined;
		n = (n.parent as { type: string; parent?: unknown } | null) ?? null
	) {
		if (n.type === "PAGE") return n as unknown as PageNode;
	}
	return null;
}

// El nombre del marco de primer nivel de la página en el que está un nodo
export function topFrameName(node: SceneNode): string {
	let top: { name: string; parent: unknown } = node;
	while (
		top.parent !== null &&
		(top.parent as { type: string }).type !== "PAGE"
	)
		top = top.parent as { name: string; parent: unknown };
	return top.name;
}

export function insideInstance(node: SceneNode): boolean {
	for (let p = node.parent; p !== null; p = p.parent) {
		if (p.type === "INSTANCE") return true;
	}
	return false;
}

// El texto visible de un nodo: lo de los textos que ningún antecesor (hasta el propio nodo, sin contarlo) oculta. Un
// contador oculto dentro de una pestaña no es parte del texto de la pestaña
export function visibleText(node: SceneNode): string {
	const texts =
		node.type === "TEXT" ? [node] : descendantsOfType(node, ["TEXT"]);
	const shown = (text: SceneNode): boolean => {
		let p: SceneNode | (BaseParent | null) = text;
		while (p !== null && p !== node) {
			if ("visible" in p && !p.visible) return false;
			p = (p as { parent: BaseParent | null }).parent;
		}
		return true;
	};
	return texts
		.filter(shown)
		.map((t) => (t as unknown as { characters: string }).characters.trim())
		.filter((t) => t !== "")
		.join(" ");
}

type BaseParent = { visible?: boolean; parent: BaseParent | null };
