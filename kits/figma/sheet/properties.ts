// Propiedades y referencias del set: TEXT por el texto que dice `match`, BOOLEAN por capa (visible) o
// por icono, INSTANCE_SWAP por icono con los del catálogo como preferidos. Las referencias solo van en capas propias: dentro de
// una instancia anidada Figma lanza (H8, medido). Sobre un set que ya existe, una propiedad
// con ese nombre se conserva (misma clave) y solo cambia lo que difiere (H3, medido); los huecos los crea slots.ts.
import { fail, figmaApi, note } from "../core.ts";
import type { Ctx } from "../screen/ctx.ts";
import type { ComponentNode, ComponentSetNode, SceneNode } from "../types.ts";
import type { SetVariant } from "./set.ts";
import type { ComponentPlan, SheetEntry } from "./types.ts";

type Keys = Map<string, string>;
type PropType = "TEXT" | "BOOLEAN" | "INSTANCE_SWAP" | "SLOT";
type Preferred = { type: "COMPONENT"; key: string }[];

export const baseName = (key: string): string => key.split("#")[0] ?? key;

const slotKeyOf = (node: SceneNode): string =>
	(node.componentPropertyReferences as { slotContentId?: string } | null)
		?.slotContentId ?? "";

export const ownLayer = (node: SceneNode, root: SceneNode): boolean => {
	for (let p = node.parent; p !== null && p.id !== root.id; p = p.parent) {
		if ((p as SceneNode).type === "INSTANCE") return false;
	}
	return true;
};

// Las propiedades que los datos de la hoja declaran (nombre y tipo): lo que no está aquí ni en `keep` es de alguien a mano
export function declaredProperties(
	sheet: SheetEntry,
): { name: string; type: PropType }[] {
	const out: { name: string; type: PropType }[] = [];
	for (const t of sheet.texts ?? []) out.push({ name: t.name, type: "TEXT" });
	for (const o of sheet.icons ?? []) {
		if (o.boolean !== undefined) out.push({ name: o.boolean, type: "BOOLEAN" });
		if (o.swap !== undefined) out.push({ name: o.swap, type: "INSTANCE_SWAP" });
	}
	for (const b of sheet.booleans ?? [])
		out.push({ name: b.name, type: "BOOLEAN" });
	for (const s of sheet.slots ?? []) {
		out.push({ name: s.name, type: "SLOT" });
		if (s.boolean !== undefined) out.push({ name: s.boolean, type: "BOOLEAN" });
	}
	return out;
}

// Las propiedades del set que no son de variante, por clave
export const handMadeKeys = (set: ComponentSetNode): string[] =>
	Object.keys(set.componentPropertyDefinitions).filter(
		(k) => set.componentPropertyDefinitions[k]?.type !== "VARIANT",
	);

// Medido en el archivo de pruebas (2026-11-12): al ocultar una capa por referencia de propiedad, Figma no siempre recalcula el auto-layout
// que la contiene (el ancho de un marco que se ajusta al contenido, o el de un hijo que rellena: unas variantes de un set de 216
// se quedan con «todo visible»). Asignar `visible` directamente a la capa oculta sí lo recalcula
function settleHidden(layers: readonly SceneNode[]): void {
	for (const layer of layers) {
		if (layer.visible) continue;
		layer.visible = true;
		layer.visible = false;
	}
}

const sameJson = (a: unknown, b: unknown): boolean =>
	JSON.stringify(a) === JSON.stringify(b);

export function addProperties(
	ctx: Ctx,
	plan: ComponentPlan,
	set: ComponentSetNode,
	variants: readonly SetVariant[],
): { keys: Keys; updated: string[] } {
	const { sheet } = plan;
	const keys: Keys = new Map();
	const updated: string[] = [];
	// Lo que había antes de este paso, por nombre: esas propiedades se conservan; las que cree este paso no cuentan
	const existing = new Map<string, string>();
	for (const k of handMadeKeys(set)) existing.set(baseName(k), k);
	const add = (
		id: string,
		name: string,
		type: "TEXT" | "BOOLEAN" | "INSTANCE_SWAP",
		value: string | boolean,
		options?: { preferredValues: Preferred },
	): void => {
		if (keys.has(id)) return;
		const found = existing.get(name);
		if (found !== undefined) {
			const def = set.componentPropertyDefinitions[found];
			if (def?.type !== type) {
				fail(
					"SHEET_PROPERTY_TYPE",
					`La propiedad «${name}» del set es de tipo ${String(def?.type)} y los datos la piden ${type}: Figma no cambia el tipo de una propiedad.`,
					"Quita o renombra esa propiedad a mano en Figma, o cambia su nombre en sheets.json, y repite el paso.",
				);
			}
			const change: {
				defaultValue?: string | boolean;
				preferredValues?: Preferred;
			} = {};
			if (def.defaultValue !== value) change.defaultValue = value;
			if (
				options !== undefined &&
				!sameJson(
					(def.preferredValues ?? []).map((p) => p.key).sort(),
					options.preferredValues.map((p) => p.key).sort(),
				)
			)
				change.preferredValues = options.preferredValues;
			if (Object.keys(change).length === 0) {
				keys.set(id, found);
				return;
			}
			keys.set(id, set.editComponentProperty(found, change));
			updated.push(name);
			return;
		}
		keys.set(
			id,
			options === undefined
				? set.addComponentProperty(name, type, value)
				: set.addComponentProperty(name, type, value, options),
		);
	};
	for (const t of sheet.texts ?? []) add(`T${t.name}`, t.name, "TEXT", t.match);
	const preferred = [...ctx.icons.values()].map((c: ComponentNode) => ({
		type: "COMPONENT" as const,
		key: c.key,
	}));
	for (const o of sheet.icons ?? []) {
		if (o.boolean !== undefined)
			add(`B${o.boolean}`, o.boolean, "BOOLEAN", o.on === true);
		if (o.swap !== undefined) {
			const icon = ctx.icons.get(o.icon);
			if (icon === undefined) {
				note.warn(
					"ICON_NOT_FOUND",
					`El icono «${o.icon}» de la propiedad «${o.swap}» no está en el catálogo de iconos: esa propiedad no se crea.`,
				);
				continue;
			}
			add(`S${o.swap}`, o.swap, "INSTANCE_SWAP", icon.id, {
				preferredValues: preferred,
			});
		}
	}
	for (const b of sheet.booleans ?? [])
		add(`B${b.name}`, b.name, "BOOLEAN", b.on === true);
	for (const s of sheet.slots ?? [])
		if (s.boolean !== undefined)
			add(`B${s.boolean}`, s.boolean, "BOOLEAN", true);

	const mixed = figmaApi().mixed;
	// las capas a las que se les ha puesto la referencia `visible`
	const visibleRefs: SceneNode[] = [];
	const prefix = plan.map.icons.prefix;
	// Cada búsqueda filtra por completo ANTES de asignar. Leer nodos entre una referencia
	// `visible` y la siguiente hace que Figma recalcule el auto-layout a medias (anchos de variante distintos)
	for (const v of variants) {
		const c = v.component;
		for (const t of sheet.texts ?? []) {
			const key = keys.get(`T${t.name}`);
			if (key === undefined) continue;
			const targets = c
				.findAllWithCriteria({ types: ["TEXT"] })
				.filter(
					(x) =>
						x.characters.trim() === t.match &&
						x.fontName !== mixed &&
						ownLayer(x, c),
				);
			for (const x of targets)
				x.componentPropertyReferences = { characters: key };
		}
		const icons = c
			.findAllWithCriteria({ types: ["INSTANCE"] })
			.filter((x) => x.name.startsWith(prefix) && ownLayer(x, c));
		for (const x of icons) {
			const o = (sheet.icons ?? []).find(
				(i) => i.icon === x.name.slice(prefix.length),
			);
			if (o === undefined) continue;
			const refs: Record<string, string> = {};
			const swap = o.swap === undefined ? undefined : keys.get(`S${o.swap}`);
			if (swap !== undefined) refs["mainComponent"] = swap;
			const skip =
				Object.entries(o.noBooleanWhen ?? {}).length > 0 &&
				Object.entries(o.noBooleanWhen ?? {}).every(
					([k, val]) => v.props[k] === val,
				);
			const bool =
				o.boolean === undefined ? undefined : keys.get(`B${o.boolean}`);
			if (bool !== undefined && !skip) refs["visible"] = bool;
			x.componentPropertyReferences = refs;
			if (refs["visible"] !== undefined) visibleRefs.push(x);
		}
		for (const b of sheet.booleans ?? []) {
			const key = keys.get(`B${b.name}`);
			if (key === undefined) continue;
			const targets = c.findAll((n) => n.name === b.layer && ownLayer(n, c));
			for (const x of targets) {
				x.componentPropertyReferences = {
					...(x.componentPropertyReferences ?? {}),
					visible: key,
				};
				visibleRefs.push(x);
			}
		}
		for (const s of sheet.slots ?? []) {
			const key =
				s.boolean === undefined ? undefined : keys.get(`B${s.boolean}`);
			if (key === undefined) continue;
			// Figma renombra el nodo SLOT con el de su propiedad al compartirla (medido): se busca por la clave de la propiedad
			const targets = c
				.findAllWithCriteria({ types: ["SLOT"] })
				.filter((n) => ownLayer(n, c) && baseName(slotKeyOf(n)) === s.name);
			for (const x of targets) {
				x.componentPropertyReferences = {
					...(x.componentPropertyReferences ?? {}),
					visible: key,
				};
				visibleRefs.push(x);
			}
		}
	}
	settleHidden(visibleRefs);
	return { keys, updated };
}
