// Nombre de capa por su papel (kit.layers.role): lo que un diseñador entiende al abrir la capa, no la etiqueta HTML. Los
// nombres salen de map@1 (`layers.roles`); los scripts de enlaces buscan capas por ellos.
import type { PlanMap, PlanNode } from "./types.ts";

type Layers = PlanMap["layers"];

// Las etiquetas cuyo nombre lleva delante lo que dicen («botón · Guardar»)
const HINT_TAGS = new Set(["button", "a", "label"]);
const HEADING = /^h[1-6]$/;
const HINT_MAX = 32;

// Los papeles que no son una etiqueta HTML: si el mapa no los nombra, se usa la palabra en inglés
const FALLBACK = Object.freeze({
	heading: "heading",
	text: "text",
	icon: "icon",
	group: "group",
	grid: "grid",
	column: "column",
	row: "row",
	block: "block",
} as const);

export const allText = (n: PlanNode): string[] =>
	n.t === "text" ? [n.txt ?? ""] : (n.kids ?? []).flatMap(allText);

export function layerRole(n: PlanNode, layers: Layers): string {
	const kids = n.kids ?? [];
	const tag = n.tag ?? "div";
	const named = (key: keyof typeof FALLBACK): string =>
		layers.roles[key] ?? FALLBACK[key];
	const hint = (role: string): string => {
		if (!layers.textPrefix) return role;
		const text = allText(n).join(" ").replace(/\s+/g, " ").trim();
		if (text === "") return role;
		return `${role} · ${text.length > HINT_MAX ? `${text.slice(0, HINT_MAX - 1)}…` : text}`;
	};
	if (HEADING.test(tag)) return hint(named("heading"));
	const byTag = layers.roles[tag];
	if (HINT_TAGS.has(tag) && byTag !== undefined) return hint(byTag);
	if (byTag !== undefined) return byTag;
	if (kids.length > 0 && kids.every((k) => k.t === "text"))
		return named("text");
	if (kids.length > 0 && kids.every((k) => k.t === "svg")) return named("icon");
	if (tag === "span") return named("group");
	if (n.disp === "grid" || n.wrap === "wrap") return named("grid");
	if (/flex/.test(n.disp ?? ""))
		return n.dir === "column" ? named("column") : named("row");
	return named("block");
}
