// Las sobrescrituras que las instancias de otras pantallas tienen en capas de dentro de una variante. Repintar la variante
// recrea esas capas con otros ids y Figma las liga por id, así que se leen ANTES por su ruta (nombres e índice entre hermanas
// del mismo nombre, desde la raíz de la variante) y se reaplican en la capa que ocupa esa ruta después. Lo que no se puede
// reaplicar (un campo que el kit no copia, una capa que ya no estaba antes de rehacer) se avisa con su ruta y su valor.
import { figmaApi, note } from "../core.ts";
import { pageOf, topFrameName } from "../tree.ts";
import type {
	ComponentNode,
	InstanceNode,
	PageNode,
	SceneNode,
	TextNode,
} from "../types.ts";

type Step = { name: string; nth: number };
type Value = string | boolean;

// Lo que se reaplica, y en qué capas; el resto de campos de `overriddenFields` se pierde y se avisa
const KEPT: Readonly<Record<string, (node: SceneNode) => boolean>> = {
	characters: (node) => node.type === "TEXT",
	visible: () => true,
	componentProperties: (node) => node.type === "INSTANCE",
};
// Medido en el archivo de pruebas (2026-11-15): campos que Figma marca a la vez que otro reaplicado y que vuelven con él (los tramos
// de un texto con su texto, el nombre de una instancia cambiada por propiedad con la propiedad)
const DERIVED: Readonly<Record<string, string>> = {
	styledTextSegments: "characters",
	name: "componentProperties",
};
// Un valor largo (un texto, una lista de pinturas) se recorta en el aviso
const MAX_VALUE = 60;
const UNKNOWN = "?";
const ORPHAN = " (sin capa antes de rehacer)";
const CHANGED = " (la capa cambió)";

// Un cambio que no vuelve: la capa (ruta o id), por qué y cada campo con su valor
export type Dropped = {
	instance: InstanceNode;
	path: string;
	reason: string;
	values: string[];
};

// Lo recogido de una capa de una instancia: solo texto, visibilidad y propiedades de una instancia anidada; estilos y
// geometría no se copian (van a `Dropped`)
export type Saved = {
	instance: InstanceNode;
	path: Step[];
	sig: string;
	characters?: string;
	visible?: boolean;
	properties?: Record<string, Value>;
};

export type Captured = { saved: Saved[]; dropped: Dropped[] };

const childrenOf = (n: unknown): readonly SceneNode[] =>
	(n as { children?: readonly SceneNode[] }).children ?? [];

const show = (path: readonly Step[]): string =>
	path.map((s) => (s.nth > 0 ? `${s.name}[${s.nth}]` : s.name)).join(" > ");

// Lo que una instancia anidada tiene distinto de lo que trae su componente
async function changedProperties(
	node: InstanceNode,
): Promise<Record<string, Value>> {
	const main = await node.getMainComponentAsync();
	const owner = main?.parent?.type === "COMPONENT_SET" ? main.parent : main;
	const defs = owner?.componentPropertyDefinitions ?? {};
	const out: Record<string, Value> = {};
	for (const [key, prop] of Object.entries(node.componentProperties)) {
		if (prop.type === "SLOT") continue;
		if (prop.value !== defs[key]?.defaultValue) out[key] = prop.value;
	}
	return out;
}

// Qué es la capa en sustancia: su tipo y, según el tipo, el componente de una instancia o los nombres de sus hijos directos.
// Basta para distinguir una capa que cambió de papel (el botón que pasa a llamarse «bloque» y deja su nombre al modal) sin
// atar la firma a detalles que un repintado legítimo sí cambia (estilos, textos, geometría)
async function signature(node: SceneNode): Promise<string> {
	if (node.type === "INSTANCE") {
		const main = await (node as InstanceNode).getMainComponentAsync();
		const owner = main?.parent?.type === "COMPONENT_SET" ? main.parent : main;
		return `INSTANCE:${owner?.id ?? ""}`;
	}
	if (node.type === "TEXT") return "TEXT";
	return `${node.type}:${childrenOf(node)
		.map((c) => c.name)
		.join("|")}`;
}

const clip = (text: string): string =>
	text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text;

const hex = (c: { r: number; g: number; b: number }): string =>
	`#${[c.r, c.g, c.b]
		.map((x) =>
			Math.round(x * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;

// Una pintura sólida como color; el resto, por su tipo
const paintOf = (p: unknown): string => {
	const paint = p as {
		type?: string;
		color?: { r: number; g: number; b: number };
	};
	return paint.type === "SOLID" && paint.color !== undefined
		? hex(paint.color)
		: (paint.type ?? UNKNOWN);
};

const PAINTS = ["fills", "strokes"];

// El valor de un campo tal como se ve, corto: texto entre comillas, pinturas por color, listas por cuántos elementos
function showValue(field: string, value: unknown): string {
	if (value === undefined) return UNKNOWN;
	if (typeof value === "symbol") return "mezclado";
	if (typeof value === "string") return `"${clip(value)}"`;
	if (typeof value !== "object" || value === null) return String(value);
	if (Array.isArray(value))
		return PAINTS.includes(field)
			? value.length === 0
				? "ninguno"
				: clip(value.map(paintOf).join(","))
			: `${value.length} elementos`;
	return clip(JSON.stringify(value));
}

const fieldsOf = (node: SceneNode | null, fields: readonly string[]) =>
	fields.map(
		(f) =>
			`${f}=${node === null ? UNKNOWN : showValue(f, (node as unknown as Record<string, unknown>)[f])}`,
	);

// Lo que se pierde sí o sí: un campo que no se reaplica en esta capa, salvo el que vuelve con otro que sí
function droppedFields(node: SceneNode, changed: readonly string[]): string[] {
	const kept = (f: string): boolean => KEPT[f]?.(node) ?? false;
	return changed.filter((f) => {
		const partner = DERIVED[f];
		return (
			!kept(f) &&
			!(partner !== undefined && changed.includes(partner) && kept(partner))
		);
	});
}

// La ruta de una capa desde la raíz de su variante (o la de la instancia en que vive)
function pathFrom(node: SceneNode): Step[] {
	const steps: Step[] = [];
	let n: SceneNode = node;
	while (n.parent !== null && n.parent.type !== "PAGE") {
		const parent = n.parent as SceneNode;
		const nth = childrenOf(parent)
			.filter((c) => c.name === n.name)
			.indexOf(n);
		steps.unshift({ name: n.name, nth: Math.max(0, nth) });
		if (
			parent.type === "COMPONENT" ||
			parent.type === "INSTANCE" ||
			parent.type === "COMPONENT_SET"
		)
			break;
		n = parent;
	}
	return steps;
}

// Una entrada de `overrides` cuyo id no es de ninguna capa de la instancia (la capa de otra variante, antes de cambiarla):
// su ruta sale de la capa de origen y el valor, de la capa que ocupa esa ruta en la instancia
async function orphan(
	instance: InstanceNode,
	id: string,
	fields: readonly string[],
): Promise<Dropped> {
	const source = id.split(";").at(-1) ?? id;
	const origin = (await figmaApi().getNodeByIdAsync(
		source,
	)) as SceneNode | null;
	const path = origin === null ? null : pathFrom(origin);
	const here = path === null ? null : resolve(instance, path);
	return {
		instance,
		path: path === null ? id : show(path),
		reason: ORPHAN,
		values: fieldsOf(here, fields),
	};
}

async function readInstance(instance: InstanceNode): Promise<Captured> {
	const fields = new Map<string, string[]>();
	for (const o of instance.overrides)
		if (o.id !== instance.id) fields.set(o.id, o.overriddenFields);
	const saved: Saved[] = [];
	const dropped: Dropped[] = [];
	const seen = new Set<string>();
	const walk = async (
		node: SceneNode,
		path: readonly Step[],
	): Promise<void> => {
		const names = new Map<string, number>();
		for (const child of childrenOf(node)) {
			const nth = names.get(child.name) ?? 0;
			names.set(child.name, nth + 1);
			const here = [...path, { name: child.name, nth }];
			const changed = fields.get(child.id);
			if (changed !== undefined) {
				seen.add(child.id);
				const lost = droppedFields(child, changed);
				if (lost.length > 0)
					dropped.push({
						instance,
						path: show(here),
						reason: "",
						values: fieldsOf(child, lost),
					});
				const entry: Saved = {
					instance,
					path: here,
					sig: await signature(child),
				};
				if (changed.includes("characters") && child.type === "TEXT")
					entry.characters = (child as TextNode).characters;
				if (changed.includes("visible")) entry.visible = child.visible;
				if (
					changed.includes("componentProperties") &&
					child.type === "INSTANCE"
				) {
					const properties = await changedProperties(child as InstanceNode);
					if (Object.keys(properties).length > 0) entry.properties = properties;
				}
				if (
					entry.characters !== undefined ||
					entry.visible !== undefined ||
					entry.properties !== undefined
				)
					saved.push(entry);
			}
			await walk(child, here);
		}
	};
	await walk(instance, []);
	for (const [id, changed] of fields)
		if (!seen.has(id)) dropped.push(await orphan(instance, id, changed));
	return { saved, dropped };
}

// Antes de vaciar la variante: lo que cada instancia fuera de la página de la hoja tiene cambiado en sus capas de dentro
// (lo de su raíz sobrevive y no se toca)
export async function captureOverrides(
	variant: ComponentNode,
	page: PageNode,
): Promise<Captured> {
	const out: Captured = { saved: [], dropped: [] };
	for (const inst of await variant.getInstancesAsync()) {
		if (pageOf(inst)?.id === page.id) continue;
		const read = await readInstance(inst);
		out.saved.push(...read.saved);
		out.dropped.push(...read.dropped);
	}
	return out;
}

function resolve(
	instance: InstanceNode,
	path: readonly Step[],
): SceneNode | null {
	let node: SceneNode = instance;
	for (const step of path) {
		const next: SceneNode | undefined = childrenOf(node).filter(
			(c) => c.name === step.name,
		)[step.nth];
		if (next === undefined) return null;
		node = next;
	}
	return node;
}

const valuesOf = (s: Saved): string[] => [
	...(s.characters === undefined
		? []
		: [`characters=${showValue("characters", s.characters)}`]),
	...(s.visible === undefined ? [] : [`visible=${s.visible}`]),
	...Object.entries(s.properties ?? {}).map(
		([k, v]) => `${k}=${showValue(k, v)}`,
	),
];

async function apply(saved: Saved, node: SceneNode): Promise<boolean> {
	let ok = true;
	if (saved.properties !== undefined && node.type === "INSTANCE") {
		const inst = node as InstanceNode;
		for (const [key, value] of Object.entries(saved.properties)) {
			if (inst.componentProperties[key]?.value === value) continue;
			try {
				inst.setProperties({ [key]: value });
			} catch {
				ok = false;
			}
		}
	}
	if (saved.characters !== undefined && node.type === "TEXT") {
		const text = node as TextNode;
		if (text.characters !== saved.characters) {
			try {
				if (typeof text.fontName !== "symbol")
					await figmaApi().loadFontAsync(text.fontName);
				text.characters = saved.characters;
			} catch {
				ok = false;
			}
		}
	}
	if (saved.visible !== undefined && node.visible !== saved.visible) {
		try {
			node.visible = saved.visible;
		} catch {
			ok = false;
		}
	}
	return ok;
}

// Después de repintar: cada cambio vuelve a la capa que ocupa su ruta. Si la ruta ya no existe, la capa es otra cosa o Figma
// rechaza el valor no falla; eso y lo que ya se sabía perdido al leer se avisa, una vez por instancia, con ruta y valor
export async function reapplyOverrides(captured: Captured): Promise<void> {
	const lost = new Map<InstanceNode, Dropped[]>();
	const add = (d: Dropped): void => {
		lost.set(d.instance, [...(lost.get(d.instance) ?? []), d]);
	};
	for (const d of captured.dropped) add(d);
	for (const s of captured.saved) {
		const node = resolve(s.instance, s.path);
		const reason =
			node === null
				? ""
				: (await signature(node)) !== s.sig
					? CHANGED
					: (await apply(s, node))
						? null
						: "";
		if (reason !== null)
			add({
				instance: s.instance,
				path: show(s.path),
				reason,
				values: valuesOf(s),
			});
		else if (node !== null) note.mutated(node);
	}
	for (const [inst, drops] of lost) {
		const page = pageOf(inst)?.name ?? "";
		const count = drops.reduce((n, d) => n + d.values.length, 0);
		note.warn(
			"OVERRIDES_LOST",
			`La instancia «${inst.name}» (página «${page}», marco «${topFrameName(inst)}») perdió ${count === 1 ? "un cambio" : `${count} cambios`} al rehacer la hoja: la capa ya no existe, cambió de papel, no admite el valor o es un campo que el kit no reaplica. Cambios: ${drops.map((d) => `${d.path}${d.reason}: ${d.values.join(", ")}`).join("; ")}.`,
			inst.id,
		);
	}
}
