// Rehacer una hoja sobre el set que ya existe. Regla: lo que tiene id y lo usan otros se conserva
// (el set, cada variante emparejada por sus props, cada propiedad por su nombre); lo de dentro de una variante se repinta.
import { propsOfVariant } from "../components.ts";
import { fail, figmaApi, note } from "../core.ts";
import { replaceContent } from "../frames.ts";
import { tagNode } from "../nodes.ts";
import { LINKABLE_TYPES, pageOf } from "../tree.ts";
import {
	type ComponentNode,
	type ComponentSetNode,
	type FrameNode,
	KEY,
	NS,
	type PageNode,
	SHEET_SCRATCH_KEY_PREFIX,
} from "../types.ts";
import { captureOverrides, reapplyOverrides } from "./overrides.ts";
import {
	baseName,
	declaredProperties,
	handMadeKeys,
	ownLayer,
} from "./properties.ts";
import { finishSet, type SetVariant } from "./set.ts";
import type { ComponentPlan } from "./types.ts";
import type { PaintedVariant } from "./variants.ts";

export type Counts = { created: number; updated: number; kept: number };

const messageOf = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

// Lo que el pintor pone en la raíz de una variante y `replaceContent` no copia (layout y relleno ya los copia él)
const APPEARANCE = [
	"layoutWrap",
	"counterAxisSpacing",
	"strokesIncludedInLayout",
	"topLeftRadius",
	"topRightRadius",
	"bottomLeftRadius",
	"bottomRightRadius",
	"strokes",
	"strokeAlign",
	"strokeTopWeight",
	"strokeRightWeight",
	"strokeBottomWeight",
	"strokeLeftWeight",
	"effects",
	"opacity",
] as const;

// Copia esas propiedades de un nodo a otro; las que no existen en el origen se saltan y las que Figma rechaza avisan
export function copyProps(
	from: object,
	to: object,
	props: readonly string[],
	name: string,
	nodeId: string,
): void {
	const source = from as Record<string, unknown>;
	const target = to as Record<string, unknown>;
	for (const prop of props) {
		if (source[prop] === undefined) continue;
		try {
			target[prop] = source[prop];
		} catch (e) {
			note.warn(
				"LAYOUT_PROP",
				`No se pudo copiar «${prop}» a «${name}»: ${messageOf(e)}`,
				nodeId,
			);
		}
	}
}

export const propsKey = (props: Readonly<Record<string, string>>): string =>
	JSON.stringify(Object.entries(props).sort(([a], [b]) => a.localeCompare(b)));

export type Located = {
	page: PageNode | null;
	adopted: boolean;
	set: ComponentSetNode | null;
	setAdopted: boolean;
};

// El set de la hoja que ya existe, sin escribir nada: el de su clave (en cualquier página menos las aparte) o, si no, el que se
// llama como la hoja en su página. En la página aparte no se rehace nada: se vacía y se pinta de nuevo
export async function locateSet(
	plan: ComponentPlan,
	page: PageNode | null,
): Promise<{ set: ComponentSetNode | null; adopted: boolean }> {
	const setKey = plan.target.set.key;
	const found: ComponentSetNode[] = [];
	for (const p of figmaApi().root.children) {
		if (p.getSharedPluginData(NS, KEY).startsWith(SHEET_SCRATCH_KEY_PREFIX))
			continue;
		await p.loadAsync();
		for (const node of p.findAllWithCriteria({
			types: ["COMPONENT_SET"],
			sharedPluginData: { namespace: NS, keys: [KEY] },
		})) {
			if (node.getSharedPluginData(NS, KEY) === setKey) found.push(node);
		}
	}
	if (found.length > 1) {
		note.warn(
			"KEY_DUPLICATED",
			`La clave «${setKey}» está en ${found.length} sets; se usa el primero.`,
			found[0]?.id,
		);
	}
	const byKey = found[0];
	if (byKey !== undefined) return { set: byKey, adopted: false };
	if (page === null) return { set: null, adopted: false };
	const wanted = plan.target.set.name.trim();
	const byName = page
		.findAllWithCriteria({ types: ["COMPONENT_SET"] })
		.find((n) => n.name.trim() === wanted);
	return { set: byName ?? null, adopted: byName !== undefined };
}

// Las propiedades del set que los datos de la hoja no declaran y `keep` no nombra: las hizo alguien a mano
export function handMadeNames(
	plan: ComponentPlan,
	set: ComponentSetNode,
): string[] {
	const names = new Set(declaredProperties(plan.sheet).map((d) => d.name));
	const keep = new Set(plan.sheet.keep ?? []);
	return handMadeKeys(set)
		.map(baseName)
		.filter((n) => !names.has(n) && !keep.has(n));
}

// Antes de escribir nada: las propiedades del set que los datos no declaran (y `keep` no nombra) las hizo alguien a mano y
// repintar las dejaría sin capas; y las de un nombre que los datos piden con otro tipo, que Figma no cambia
export function checkRebuild(plan: ComponentPlan, set: ComponentSetNode): void {
	const declared = declaredProperties(plan.sheet);
	const defs = set.componentPropertyDefinitions;
	const hand = handMadeNames(plan, set);
	if (hand.length > 0) {
		fail(
			"SHEET_HAND_EDITS",
			`El set «${set.name}» tiene propiedades que los datos de la hoja no declaran: ${hand.map((n) => `«${n}»`).join(", ")}. Repintar las dejaría sin capas.`,
			"Añade su nombre a `keep` de la hoja en sheets.json (se conservan tal cual) o declara su capa con texts, booleans, icons o slots, y repite el paso.",
		);
	}
	const wrong: string[] = [];
	for (const key of handMadeKeys(set)) {
		const want = declared.find((d) => d.name === baseName(key));
		if (want !== undefined && defs[key]?.type !== want.type)
			wrong.push(
				`«${baseName(key)}» es ${String(defs[key]?.type)} y los datos piden ${want.type}`,
			);
	}
	if (wrong.length > 0) {
		fail(
			"SHEET_PROPERTY_TYPE",
			`Hay propiedades del set de «${plan.sheet.key}» con otro tipo del que piden los datos: ${wrong.join("; ")}. Figma no cambia el tipo de una propiedad.`,
			"Quita o renombra esa propiedad a mano en Figma, o cambia su nombre en sheets.json, y repite el paso.",
		);
	}
}

export type Outside = { count: number; overrides: number };

// Las instancias de las variantes del set que están fuera de la página de la hoja, y lo que llevan cambiado (`overrides`)
export async function outsideInstances(
	set: ComponentSetNode,
	page: PageNode,
): Promise<Outside> {
	const out = { count: 0, overrides: 0 };
	for (const v of set.children) {
		if (v.type !== "COMPONENT") continue;
		for (const inst of await v.getInstancesAsync()) {
			if (pageOf(inst)?.id === page.id) continue;
			out.count += 1;
			out.overrides += inst.overrides.length;
		}
	}
	return out;
}

// La cabecera y la tarjeta de antes (la que lleva el set): se quitan al acabar, con el set ya en la nueva. Se miden ANTES de
// pintar las nuevas
export function oldFrames(
	set: ComponentSetNode,
	page: PageNode,
	plan: ComponentPlan,
): FrameNode[] {
	const old: FrameNode[] = [];
	let top: { type: string; parent: unknown } = set;
	while (
		top.parent !== null &&
		(top.parent as { type: string }).type !== "PAGE"
	)
		top = top.parent as { type: string; parent: unknown };
	if (
		(top as unknown) !== set &&
		top.type === "FRAME" &&
		(top as unknown as FrameNode).name.trim() === plan.sheet.title.trim()
	)
		old.push(top as unknown as FrameNode);
	else if ((top as unknown) !== set) {
		note.warn(
			"OLD_CARD_KEPT",
			`El set no estaba en una tarjeta «${plan.sheet.title}»: se deja lo que lo rodeaba.`,
		);
	}
	const pages = new Set<PageNode>([page]);
	const home = pageOf(set);
	if (home !== null) pages.add(home);
	for (const p of pages)
		for (const child of p.children)
			if (child.type === "FRAME" && child.name === "Header") old.push(child);
	return old;
}

export function removeOld(frames: readonly FrameNode[]): void {
	note.removed(frames);
	for (const frame of frames) if (!frame.removed) frame.remove();
}

type Alias = { id: string };
const isAlias = (v: unknown): v is Alias =>
	v !== null && typeof v === "object" && !Array.isArray(v) && "id" in v;

// Las variables a las que el pintor ligó la raíz (relleno, espaciado, radios): copiar el número no las copia. Las que la raíz
// vieja tenía ligadas y la nueva no, se sueltan. Las pinturas ya llevan su variable dentro
async function copyBindings(
	from: ComponentNode,
	to: ComponentNode,
): Promise<void> {
	const wanted = from.boundVariables as Record<string, unknown> | undefined;
	const had = to.boundVariables as Record<string, unknown> | undefined;
	const link = (field: string, variable: { id: string } | null): void => {
		try {
			(
				to as unknown as {
					setBoundVariable(f: string, v: { id: string } | null): void;
				}
			).setBoundVariable(field, variable);
		} catch (e) {
			note.warn(
				"BINDING_FAILED",
				`No se pudo ligar «${field}» de «${to.name}»: ${messageOf(e)}`,
				to.id,
			);
		}
	};
	for (const field of Object.keys(had ?? {})) {
		if (isAlias(had?.[field]) && !isAlias(wanted?.[field])) link(field, null);
	}
	for (const [field, alias] of Object.entries(wanted ?? {})) {
		if (!isAlias(alias)) continue;
		const variable = await figmaApi().variables.getVariableByIdAsync(alias.id);
		if (variable !== null) link(field, variable);
	}
}

// Vacía la variante y le mete lo recién pintado conservando su id (las instancias siguen apuntando a ella)
// Las sobrescrituras de las instancias de fuera de `page` en capas de dentro se leen antes y se reaplican por ruta después
export async function refill(
	target: ComponentNode,
	donor: ComponentNode,
	page: PageNode,
): Promise<void> {
	const captured = await captureOverrides(target, page);
	target.resize(donor.width, donor.height);
	await replaceContent(target as unknown as FrameNode, donor, {
		copyLayout: true,
	});
	copyProps(donor, target, APPEARANCE, target.name, target.id);
	await copyBindings(donor, target);
	donor.remove();
	await reapplyOverrides(captured);
}

const plural = (n: number, one: string, many: string): string =>
	`${n} ${n === 1 ? one : many}`;

export async function rebuildSet(
	plan: ComponentPlan,
	set: ComponentSetNode,
	adopted: boolean,
	painted: readonly PaintedVariant[],
	matrix: FrameNode,
	page: PageNode,
): Promise<{ variants: SetVariant[]; counts: Counts }> {
	// el set se mueve a la tarjeta nueva; los ids se conservan al mover (medido)
	matrix.appendChild(set);
	if (adopted) {
		note.warn(
			"ADOPTED",
			`El set «${set.name}» no tenía clave: se adopta como el de la hoja.`,
			set.id,
		);
	}
	const pool = new Map<string, ComponentNode[]>();
	for (const c of set.children) {
		if (c.type !== "COMPONENT") continue;
		const key = propsKey(propsOfVariant(c));
		pool.set(key, [...(pool.get(key) ?? []), c]);
	}
	const variants: SetVariant[] = [];
	const made: ComponentNode[] = [];
	for (const [index, p] of painted.entries()) {
		const match = pool.get(propsKey(p.props))?.shift();
		if (match !== undefined) {
			await refill(match, p.component, page);
			variants.push({ index, props: p.props, component: match });
			continue;
		}
		// H6 (medido): `set.appendChild(componente)` añade una variante y lee sus props del nombre
		set.appendChild(p.component);
		made.push(p.component);
		variants.push({ index, props: p.props, component: p.component });
	}
	const mine = new Set(variants.map((v) => v.component.id));
	let kept = 0;
	for (const c of set.children) {
		if (c.type !== "COMPONENT" || mine.has(c.id)) continue;
		kept += 1;
		const outside = (await c.getInstancesAsync()).filter(
			(i) => pageOf(i)?.id !== page.id,
		);
		note.warn(
			"VARIANT_NOT_CAPTURED",
			`La variante «${c.name}» está en el set y no en la captura: se queda tal cual (${plural(outside.length, "instancia fuera de la página", "instancias fuera de la página")}).`,
			c.id,
		);
	}
	finishSet(plan, set, variants, made, false);
	return {
		variants,
		counts: {
			created: made.length,
			updated: variants.length - made.length,
			kept,
		},
	};
}

// Las claves de propiedad que alguna capa propia de alguna variante usa
function usedKeys(set: ComponentSetNode): Set<string> {
	const used = new Set<string>();
	for (const v of set.children) {
		if (v.type !== "COMPONENT") continue;
		for (const n of v.findAllWithCriteria({
			types: [...LINKABLE_TYPES, "SLOT"],
		})) {
			if (!ownLayer(n, v)) continue;
			for (const key of Object.values(n.componentPropertyReferences ?? {}))
				if (key !== undefined) used.add(key);
		}
	}
	return used;
}

// Las propiedades a mano de `keep` se conservan; avisa de las que tras repintar ya no tienen ninguna capa
export function keptProperties(
	plan: ComponentPlan,
	set: ComponentSetNode,
): number {
	const declared = new Set(declaredProperties(plan.sheet).map((d) => d.name));
	const keep = (plan.sheet.keep ?? []).filter((n) => !declared.has(n));
	if (keep.length === 0) return 0;
	const used = usedKeys(set);
	let kept = 0;
	for (const key of handMadeKeys(set)) {
		const name = baseName(key);
		if (!keep.includes(name)) continue;
		kept += 1;
		if (!used.has(key)) {
			note.warn(
				"PROPERTY_KEPT",
				`La propiedad «${name}» se conserva, pero ninguna capa de las variantes la usa ya.`,
			);
		}
	}
	return kept;
}

export { tagNode };
