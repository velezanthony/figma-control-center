// Catálogo de componentes: búsqueda con caché, set de una instancia, variante por props y clon de variantes.
import { fail, figmaApi, note, stateOf } from "./core.ts";
import type {
	ComponentNode,
	ComponentSetNode,
	InstanceNode,
	SceneNode,
} from "./types.ts";

type Catalog = ComponentSetNode | ComponentNode;

const isCatalog = (node: unknown): node is Catalog => {
	const n = node as { type?: string; removed?: boolean } | null;
	return (
		n !== null &&
		(n.type === "COMPONENT_SET" || n.type === "COMPONENT") &&
		n.removed !== true
	);
};

// Un componente suelto o un set por su nombre. Las variantes (hijas de un set) no cuentan: se llaman «prop=valor»
export async function findComponent(name: string): Promise<Catalog | null> {
	const wanted = name.trim();
	// nombre → id. Cada acierto se comprueba (el nodo sigue ahí): la caché nunca da un componente borrado
	const cache = stateOf().components;
	const cachedId = cache.get(wanted);
	if (cachedId !== undefined) {
		const hit = await figmaApi().getNodeByIdAsync(cachedId);
		if (isCatalog(hit) && hit.name.trim() === wanted) return hit;
		cache.delete(wanted);
	}
	let standalone: Catalog | null = null;
	for (const page of figmaApi().root.children) {
		await page.loadAsync();
		for (const node of page.findAllWithCriteria({
			types: ["COMPONENT_SET", "COMPONENT"],
		})) {
			if (node.name.trim() !== wanted) continue;
			if (node.type === "COMPONENT_SET") {
				cache.set(wanted, node.id);
				return node;
			}
			if (node.parent?.type !== "COMPONENT_SET") standalone ??= node;
		}
	}
	if (standalone !== null) cache.set(wanted, standalone.id);
	return standalone;
}

// El set (o el componente suelto) al que pertenece una instancia
export async function setNameOf(
	instance: InstanceNode,
): Promise<string | null> {
	const main = await instance.getMainComponentAsync();
	if (main === null) return null;
	return main.parent?.type === "COMPONENT_SET" ? main.parent.name : main.name;
}

export const propsOfVariant = (
	variant: ComponentNode,
): Record<string, string> => {
	if (variant.variantProperties) return variant.variantProperties;
	const out: Record<string, string> = {};
	for (const part of variant.name.split(",")) {
		const [k, v] = part.split("=");
		if (k !== undefined && v !== undefined) out[k.trim()] = v.trim();
	}
	return out;
};

const STRONG_WEIGHT = 1000;

// La variante que mejor cumple `props`. Los sets son dispersos: sin una exacta se elige la que más props cumple y se
// avisa. Las props `strong` han de cumplirse siempre (si ninguna variante las cumple, error)
export function pickVariant(
	set: Catalog,
	props: Readonly<Record<string, string>>,
	options: { strong?: readonly string[] } = {},
): ComponentNode {
	if (set.type === "COMPONENT") return set;
	const strong = options.strong ?? [];
	let best: ComponentNode | null = null;
	let bestScore = -1;
	let bestMisses = 0;
	for (const variant of set.children) {
		if (variant.type !== "COMPONENT") continue;
		const own = propsOfVariant(variant);
		let score = 0;
		let misses = 0;
		let excluded = false;
		for (const [name, value] of Object.entries(props)) {
			if (own[name] === value)
				score += strong.includes(name) ? STRONG_WEIGHT : 1;
			else {
				misses += 1;
				if (strong.includes(name)) excluded = true;
			}
		}
		if (excluded) continue;
		if (score > bestScore) {
			best = variant;
			bestScore = score;
			bestMisses = misses;
		}
	}
	if (best === null) {
		return fail(
			"VARIANT_NOT_FOUND",
			`«${set.name}» no tiene ninguna variante con ${strong.join(", ")} como pide ${JSON.stringify(props)}.`,
			"Mira las variantes del set con figma_components y ajusta las props.",
		);
	}
	if (bestMisses > 0) {
		note.warn(
			"VARIANT_APPROX",
			`«${set.name}» no tiene la variante ${JSON.stringify(props)}; se usa «${best.name}».`,
			best.id,
		);
	}
	return best;
}

// Mismo árbol, mismos índices: las referencias de propiedades de la original se copian capa a capa a la copia
const copyReferences = (
	original: SceneNode,
	copy: SceneNode,
	lost: string[],
) => {
	const refs = original.componentPropertyReferences;
	if (refs !== null && Object.keys(refs).length > 0) {
		copy.componentPropertyReferences = { ...refs };
		const back = copy.componentPropertyReferences ?? {};
		for (const [field, key] of Object.entries(refs)) {
			if ((back as Record<string, string | undefined>)[field] !== key)
				lost.push(copy.id);
		}
	}
	if ("children" in original && "children" in copy) {
		original.children.forEach((child, i) => {
			const twin = copy.children[i];
			if (twin !== undefined) copyReferences(child, twin, lost);
		});
	}
};

// Clona una variante en su set y repone las referencias a las propiedades que `clone()` pierde
export function cloneVariant(variant: ComponentNode): ComponentNode {
	const copy = variant.clone();
	if (variant.parent !== null && copy.parent !== variant.parent) {
		variant.parent.appendChild(copy);
	}
	const lost: string[] = [];
	copyReferences(variant, copy, lost);
	note.created(copy);
	if (lost.length > 0) {
		note.warn(
			"REFERENCES_LOST",
			`${lost.length} capas de la copia no recuperaron sus referencias a propiedades.`,
			copy.id,
		);
	}
	return copy;
}
