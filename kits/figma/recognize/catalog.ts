// Los sets que usa el reconocimiento (los de las reglas y los de las huellas), cargados UNA vez por paso en un solo recorrido
// de las páginas. Las reglas piden el set por su nombre exacto; las huellas, por su título sin mirar mayúsculas.
import { figmaApi } from "../core.ts";
import type { ComponentSetNode } from "../types.ts";

export type Catalog = {
	set(name: string): ComponentSetNode | undefined;
};

export async function loadCatalog(
	names: readonly string[],
	titles: readonly string[],
): Promise<Catalog> {
	const exact = new Map<string, ComponentSetNode>();
	const lower = new Map<string, ComponentSetNode>();
	const wantExact = new Set(names.map((n) => n.trim()));
	const wantLower = new Set(titles.map((t) => t.trim().toLowerCase()));
	const done = () =>
		exact.size >= wantExact.size && lower.size >= wantLower.size;
	if (wantExact.size > 0 || wantLower.size > 0) {
		for (const page of figmaApi().root.children) {
			await page.loadAsync();
			for (const node of page.findAllWithCriteria({
				types: ["COMPONENT_SET"],
			})) {
				const name = node.name.trim();
				if (wantExact.has(name) && !exact.has(name)) exact.set(name, node);
				const key = name.toLowerCase();
				if (wantLower.has(key) && !lower.has(key)) lower.set(key, node);
			}
			if (done()) break;
		}
	}
	return {
		set: (name) =>
			exact.get(name.trim()) ?? lower.get(name.trim().toLowerCase()),
	};
}
