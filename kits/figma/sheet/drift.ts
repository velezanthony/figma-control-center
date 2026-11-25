// Cuando Figma va por delante de la web: antes de escribir nada se compara el set que ya existe con
// la captura. Si hay desfase (props de variante solo en Figma, o variantes de Figma sin pareja), la hoja no se escribe y se
// devuelve el informe para que decida la persona; la decisión (`drift` de sheets@1) manda mientras la huella del set no cambie.
// También es desfase que las variantes tengan capas hechas a mano que el repintado borraría, o que instancias de otras
// pantallas tengan cambios en capas de dentro: el repintado recrea esas capas con otros ids y los reaplica por ruta (overrides.ts),
// pero lo que ya no tenga capa en esa ruta se pierde; saberlo antes de pintar no es posible, así que se frena y la persona autoriza.
import { propsOfVariant } from "../components.ts";
import { pageOf, topFrameName } from "../tree.ts";
import type {
	ComponentNode,
	ComponentSetNode,
	InstanceNode,
	PageNode,
	SceneNode,
} from "../types.ts";
import { findSheetPage, isScratch } from "./page.ts";
import { baseName, declaredProperties, handMadeKeys } from "./properties.ts";
import { handMadeNames, locateSet, propsKey } from "./rebuild.ts";
import type { ComponentPlan, HandMadeLayer, SetFingerprint } from "./types.ts";
import { variantName } from "./variants.ts";

export type DriftReason =
	| "drift"
	| "fingerprint-changed"
	| "map-incomplete"
	| "overrides-at-risk";

type Grouped = {
	total: number;
	pages: {
		page: string;
		count: number;
		frames: { name: string; count: number }[];
	}[];
};

// Las instancias de fuera con cambios en capas de dentro (no en su raíz): `layers` cuenta las capas cambiadas
export type OverridesAtRisk = {
	total: number;
	affected: { id: string; page: string; frame: string; layers: number }[];
};

export type DriftReport = {
	sheet: string;
	set: { id: string; name: string; page: string };
	reason: DriftReason;
	decision?: "figma" | "web" | "map";
	// props de variante que solo tiene Figma, con sus valores
	figmaOnlyProps: Record<string, string[]>;
	// variantes de Figma sin pareja en la captura y de la captura que Figma no tiene, por nombre
	figmaOnlyVariants: string[];
	webOnlyVariants: string[];
	// las propiedades de SHEET_HAND_EDITS
	handMadeProperties: string[];
	usage: Grouped;
	// capas hechas a mano en las variantes que el repintado borraría, y las instancias de fuera con algo en ellas
	handMadeLayers: HandMadeLayer[];
	handMadeUsage: Grouped & {
		kinds: {
			properties: number;
			overrides: number;
			swaps: number;
			slots: number;
		};
	};
	overridesAtRisk: OverridesAtRisk;
	// la huella actual, lista para copiar a `drift.fingerprint` de la hoja
	fingerprint: SetFingerprint;
};

export type Assessment =
	| { kind: "paint"; mapValues?: Record<string, string> }
	| { kind: "figma-wins" }
	| { kind: "blocked"; report: DriftReport };

const sorted = (xs: readonly string[]): string[] => [...xs].sort();

// Cómo está el set ahora: props de variante con sus valores, nombres de variantes y de propiedades (sin `#id`) y sus capas a
// mano, todo ordenado
export function fingerprintOf(
	set: ComponentSetNode,
	layers: readonly HandMadeLayer[],
): SetFingerprint {
	const defs = set.componentPropertyDefinitions;
	const variantProps: Record<string, string[]> = {};
	for (const key of Object.keys(defs).sort()) {
		const def = defs[key];
		if (def?.type === "VARIANT")
			variantProps[key] = sorted(def.variantOptions ?? []);
	}
	return {
		variantProps,
		variants: sorted(
			set.children.filter((c) => c.type === "COMPONENT").map((c) => c.name),
		),
		properties: sorted(handMadeKeys(set).map(baseName)),
		layers: [...layers],
	};
}

// Una capa a mano de una variante: dónde está (índices desde la raíz de la variante, igual en sus instancias) y qué propiedades
// a mano usa
type Found = {
	variant: ComponentNode;
	layer: SceneNode;
	path: number[];
	keys: string[];
	main: string | null;
};

const childrenOf = (n: unknown): readonly SceneNode[] =>
	(n as { children?: readonly SceneNode[] }).children ?? [];

const mainName = (main: ComponentNode): string =>
	main.parent?.type === "COMPONENT_SET" ? main.parent.name : main.name;

// Las capas propias de las variantes (no las de dentro de una instancia ni el contenido de un hueco) que repintar borraría sin
// recrearlas: las ligadas a una propiedad que los datos no declaran (las de `keep` y las hechas a mano; el pintor solo liga las
// declaradas) y las instancias anidadas sin propiedad declarada cuyo componente no es un icono del catálogo ni uno de `rules`
async function findHandMade(
	plan: ComponentPlan,
	set: ComponentSetNode,
): Promise<Found[]> {
	const defs = set.componentPropertyDefinitions;
	const declared = new Set(declaredProperties(plan.sheet).map((d) => d.name));
	const nests = new Set((plan.rules ?? []).map((r) => r.trim().toLowerCase()));
	const iconPages = new RegExp(plan.map.icons.pages);
	const found: Found[] = [];
	const walk = async (
		variant: ComponentNode,
		node: unknown,
		path: readonly number[],
	): Promise<void> => {
		for (const [i, layer] of childrenOf(node).entries()) {
			const at = [...path, i];
			const refs = Object.values(layer.componentPropertyReferences ?? {})
				.filter((k): k is string => k !== undefined)
				.filter((k) => defs[k] !== undefined);
			const keys = refs.filter((k) => !declared.has(baseName(k)));
			let main: ComponentNode | null = null;
			if (layer.type === "INSTANCE")
				main = await (layer as InstanceNode).getMainComponentAsync();
			const lostInstance =
				layer.type === "INSTANCE" &&
				refs.length === 0 &&
				(main === null ||
					(!iconPages.test(pageOf(main)?.name ?? "") &&
						!nests.has(mainName(main).trim().toLowerCase())));
			if (keys.length > 0 || lostInstance)
				found.push({ variant, layer, path: at, keys, main: main?.id ?? null });
			if (layer.type !== "INSTANCE" && layer.type !== "SLOT")
				await walk(variant, layer, at);
		}
	};
	for (const v of set.children)
		if (v.type === "COMPONENT") await walk(v, v, []);
	return found;
}

// Agrupadas por nombre, tipo y propiedades, con las variantes donde están: lo que sale en el informe y en la huella
function groupLayers(found: readonly Found[]): HandMadeLayer[] {
	const groups = new Map<string, HandMadeLayer>();
	for (const f of found) {
		const properties = sorted([...new Set(f.keys.map(baseName))]);
		const id = JSON.stringify([f.layer.name, f.layer.type, properties]);
		const g = groups.get(id) ?? {
			name: f.layer.name,
			type: f.layer.type,
			properties,
			variants: [],
		};
		if (!g.variants.includes(f.variant.name)) g.variants.push(f.variant.name);
		groups.set(id, g);
	}
	return [...groups.values()]
		.map((g) => ({ ...g, variants: sorted(g.variants) }))
		.sort((a, b) =>
			a.name === b.name
				? a.type.localeCompare(b.type)
				: a.name.localeCompare(b.name),
		);
}

const sameFingerprint = (a: SetFingerprint, b: SetFingerprint): boolean =>
	JSON.stringify(a) === JSON.stringify(b);

// Cuenta instancias por página y marco de primer nivel
function grouper() {
	const pages = new Map<string, Map<string, number>>();
	let total = 0;
	return {
		add(page: PageNode, inst: SceneNode): void {
			total += 1;
			const frame = topFrameName(inst);
			const frames = pages.get(page.name) ?? new Map<string, number>();
			frames.set(frame, (frames.get(frame) ?? 0) + 1);
			pages.set(page.name, frames);
		},
		done(): Grouped {
			return {
				total,
				pages: [...pages].map(([page, frames]) => ({
					page,
					count: [...frames.values()].reduce((a, b) => a + b, 0),
					frames: [...frames].map(([name, count]) => ({ name, count })),
				})),
			};
		},
	};
}

// La capa de la instancia que corresponde a una capa de su variante: los mismos índices (la instancia copia el árbol)
function sublayer(inst: SceneNode, path: readonly number[]): SceneNode | null {
	let node: SceneNode | undefined = inst;
	for (const i of path) node = childrenOf(node)[i];
	return node ?? null;
}

const subtreeIds = (node: SceneNode): Set<string> => {
	const ids = new Set<string>([node.id]);
	const add = (n: unknown): void => {
		for (const c of childrenOf(n)) {
			ids.add(c.id);
			add(c);
		}
	};
	add(node);
	return ids;
};

// Qué tiene una instancia en las capas a mano de su variante: un valor propio en una de sus propiedades, un cambio directo
// (`overrides`), otro componente en una instancia anidada o contenido distinto en un hueco
async function contentIn(
	set: ComponentSetNode,
	inst: InstanceNode,
	layers: readonly Found[],
): Promise<{
	properties: boolean;
	overrides: boolean;
	swaps: boolean;
	slots: boolean;
}> {
	const defs = set.componentPropertyDefinitions;
	const out = {
		properties: false,
		overrides: false,
		swaps: false,
		slots: false,
	};
	const overridden = new Set(inst.overrides.map((o) => o.id));
	for (const f of layers) {
		for (const k of f.keys) {
			const def = defs[k];
			const value = inst.componentProperties[k]?.value;
			if (
				def?.type !== "SLOT" &&
				value !== undefined &&
				value !== def?.defaultValue
			)
				out.properties = true;
		}
		const sub = sublayer(inst, f.path);
		if (sub === null || sub.type !== f.layer.type) continue;
		for (const id of subtreeIds(sub))
			if (overridden.has(id)) out.overrides = true;
		if (sub.type === "INSTANCE" && f.main !== null) {
			const now = await (sub as InstanceNode).getMainComponentAsync();
			if (now !== null && now.id !== f.main) out.swaps = true;
		}
		if (
			sub.type === "SLOT" &&
			childrenOf(sub).length !== childrenOf(f.layer).length
		)
			out.slots = true;
	}
	return out;
}

// Las instancias de las variantes del set fuera de la página de la hoja, por página y marco de primer nivel; y, aparte, las que
// tienen algo en las capas a mano
async function usageOf(
	set: ComponentSetNode,
	home: PageNode | null,
	found: readonly Found[],
): Promise<Pick<DriftReport, "usage" | "handMadeUsage">> {
	const all = grouper();
	const withContent = grouper();
	const kinds = { properties: 0, overrides: 0, swaps: 0, slots: 0 };
	for (const variant of set.children) {
		if (variant.type !== "COMPONENT") continue;
		const layers = found.filter((f) => f.variant.id === variant.id);
		for (const inst of await variant.getInstancesAsync()) {
			const page = pageOf(inst);
			if (page === null || page.id === home?.id) continue;
			all.add(page, inst);
			if (layers.length === 0) continue;
			const has = await contentIn(set, inst, layers);
			for (const k of Object.keys(kinds) as (keyof typeof kinds)[])
				if (has[k]) kinds[k] += 1;
			if (Object.values(has).some(Boolean)) withContent.add(page, inst);
		}
	}
	return {
		usage: all.done(),
		handMadeUsage: { ...withContent.done(), kinds },
	};
}

// Las instancias de fuera con cambios en capas de dentro: repintar recrea esas capas con otros ids y los cambios se pierden. Los
// de la raíz de la instancia (sus propiedades) sobreviven y no cuentan
async function overridesAtRisk(
	set: ComponentSetNode,
	home: PageNode | null,
): Promise<OverridesAtRisk> {
	const affected: OverridesAtRisk["affected"] = [];
	for (const variant of set.children) {
		if (variant.type !== "COMPONENT") continue;
		for (const inst of await variant.getInstancesAsync()) {
			const page = pageOf(inst);
			if (page === null || page.id === home?.id) continue;
			const layers = new Set(
				inst.overrides.map((o) => o.id).filter((id) => id !== inst.id),
			).size;
			if (layers > 0)
				affected.push({
					id: inst.id,
					page: page.name,
					frame: topFrameName(inst),
					layers,
				});
		}
	}
	return { total: affected.length, affected };
}

export async function assessSheet(
	plan: ComponentPlan,
	set: ComponentSetNode | null,
): Promise<Assessment> {
	if (set === null) return { kind: "paint" };
	const web = plan.variants.map((v) => v.props);
	const webKeys = new Set(web.map(propsKey));
	const webProps = new Set(web.flatMap((p) => Object.keys(p)));
	const figma = set.children.filter((c) => c.type === "COMPONENT");
	const figmaKeys = new Set(figma.map((c) => propsKey(propsOfVariant(c))));
	const found = await findHandMade(plan, set);
	const handMadeLayers = groupLayers(found);
	const fingerprint = fingerprintOf(set, handMadeLayers);
	const figmaOnlyProps: Record<string, string[]> = {};
	for (const [prop, values] of Object.entries(fingerprint.variantProps))
		if (!webProps.has(prop)) figmaOnlyProps[prop] = values;
	const figmaOnlyVariants = figma
		.filter((c) => !webKeys.has(propsKey(propsOfVariant(c))))
		.map((c) => c.name);
	const real =
		Object.keys(figmaOnlyProps).length > 0 ||
		figmaOnlyVariants.length > 0 ||
		handMadeLayers.length > 0;
	const decision = plan.sheet.drift;

	let risk: Promise<OverridesAtRisk> | undefined;
	const atRisk = (): Promise<OverridesAtRisk> =>
		(risk ??= overridesAtRisk(set, pageOf(set)));

	const blocked = async (reason: DriftReason): Promise<Assessment> => ({
		kind: "blocked",
		report: {
			sheet: plan.sheet.key,
			set: { id: set.id, name: set.name, page: pageOf(set)?.name ?? "" },
			reason,
			...(decision !== undefined && { decision: decision.decision }),
			figmaOnlyProps,
			figmaOnlyVariants,
			webOnlyVariants: plan.variants
				.filter((v) => !figmaKeys.has(propsKey(v.props)))
				.map((v) => variantName(v.props)),
			handMadeProperties: handMadeNames(plan, set),
			...(await usageOf(set, pageOf(set), found)),
			handMadeLayers,
			overridesAtRisk: await atRisk(),
			fingerprint,
		},
	});

	if (decision === undefined) {
		if (real) return blocked("drift");
		return (await atRisk()).total > 0
			? blocked("overrides-at-risk")
			: { kind: "paint" };
	}
	if (!sameFingerprint(decision.fingerprint, fingerprint))
		return blocked("fingerprint-changed");
	if (decision.decision === "figma") return { kind: "figma-wins" };
	if (decision.decision !== "map") return { kind: "paint" };
	// map: valores para todas las props solo-Figma y para ninguna otra
	const wanted = Object.keys(figmaOnlyProps).sort();
	const given = Object.keys(decision.values).sort();
	if (JSON.stringify(wanted) !== JSON.stringify(given))
		return blocked("map-incomplete");
	return { kind: "paint", mapValues: decision.values };
}

const MAX_AT_RISK_SHOWN = 8;

const plural = (n: number, one: string, many: string): string =>
	`${n} ${n === 1 ? one : many}`;

// El resumen corto que sale en el aviso del paso (el informe entero va en `report.drift`)
export function driftSummary(r: DriftReport): string {
	const parts: string[] = [];
	const props = Object.entries(r.figmaOnlyProps).map(
		([k, v]) => `${k} (${v.join(", ")})`,
	);
	if (props.length > 0)
		parts.push(`props de variante solo en Figma: ${props.join("; ")}`);
	if (r.figmaOnlyVariants.length > 0)
		parts.push(
			plural(
				r.figmaOnlyVariants.length,
				"variante de Figma sin pareja",
				"variantes de Figma sin pareja",
			),
		);
	if (r.webOnlyVariants.length > 0)
		parts.push(
			plural(
				r.webOnlyVariants.length,
				"variante de la web que Figma no tiene",
				"variantes de la web que Figma no tiene",
			),
		);
	if (r.handMadeProperties.length > 0)
		parts.push(`propiedades a mano: ${r.handMadeProperties.join(", ")}`);
	if (r.handMadeLayers.length > 0)
		parts.push(
			`capas a mano: ${r.handMadeLayers.map((l) => `${l.name} (${l.type})`).join(", ")}; ${plural(r.handMadeUsage.total, "instancia con contenido en ellas", "instancias con contenido en ellas")}, que el repintado perdería`,
		);
	if (r.overridesAtRisk.total > 0)
		parts.push(
			`${plural(r.overridesAtRisk.total, "instancia", "instancias")} con cambios en capas de dentro, que el repintado reaplica por ruta; los que ya no tengan capa se perderían: ${r.overridesAtRisk.affected
				.slice(0, MAX_AT_RISK_SHOWN)
				.map(
					(i) =>
						`${i.page} / ${i.frame} (${plural(i.layers, "capa", "capas")})`,
				)
				.join(
					"; ",
				)}${r.overridesAtRisk.affected.length > MAX_AT_RISK_SHOWN ? "; …" : ""}`,
		);
	parts.push(
		`${plural(r.usage.total, "instancia", "instancias")} en ${plural(r.usage.pages.length, "página", "páginas")}`,
	);
	const why =
		r.reason === "fingerprint-changed"
			? `Figma cambió desde que se decidió (decisión «${r.decision ?? ""}»)`
			: r.reason === "map-incomplete"
				? "los valores de `map` no cubren las props solo en Figma"
				: r.reason === "overrides-at-risk"
					? "rehacerla podría perder cambios de instancias en otras pantallas (se reaplican por ruta; los de capas que ya no existen se pierden)"
					: "Figma va por delante de la web";
	return `La hoja «${r.sheet}» NO se ha escrito: ${why}. ${parts.join(". ")}. Decide en el \`drift\` de la hoja en sheets.json con la huella del informe.`;
}

// Localiza el set de la hoja (sin escribir nada) y lo compara con el plan: lo que usan el paso y quien quiera mirar el desfase
// sin pintar (`kit.sheet.assess`)
export async function assessPlan(plan: ComponentPlan): Promise<{
	existing: { set: ComponentSetNode | null; adopted: boolean };
	verdict: Assessment;
}> {
	const found = await findSheetPage(plan);
	const existing = isScratch(plan)
		? { set: null, adopted: false }
		: await locateSet(plan, found.page);
	return { existing, verdict: await assessSheet(plan, existing.set) };
}
