// Los huecos de la hoja: la capa con ese nombre de cada variante pasa a hueco con `createSlot()`,
// con su contenido dentro, y las variantes comparten una sola propiedad SLOT (kit.slot.share). Si el set ya tiene una propiedad
// SLOT con ese nombre se queda con su clave y las instancias conservan lo que metieron en su hueco (H11, medido).
import { note } from "../core.ts";
import { LAYOUT_PROPS } from "../frames.ts";
import { shareSlot } from "../slots.ts";
import type { ComponentNode } from "../types.ts";
import { ownLayer } from "./properties.ts";
import { copyProps } from "./rebuild.ts";
import type { SetVariant } from "./set.ts";
import type { ComponentPlan } from "./types.ts";

const SLOT_PROPS = [...LAYOUT_PROPS, "layoutGrow", "layoutAlign"] as const;

export function addSlots(
	plan: ComponentPlan,
	variants: readonly SetVariant[],
): void {
	for (const s of plan.sheet.slots ?? []) {
		const made: ComponentNode[] = [];
		for (const v of variants) {
			const c = v.component;
			const layer = c
				.findAll((n) => n.name === s.layer && n.type !== "SLOT")
				.find((n) => ownLayer(n, c));
			const parent = layer?.parent;
			if (layer === undefined || parent === null || parent === undefined)
				continue;
			const slot = c.createSlot();
			parent.insertChild(parent.children.indexOf(layer), slot);
			slot.resize(layer.width, layer.height);
			copyProps(layer, slot, SLOT_PROPS, s.layer, slot.id);
			if (layer.type !== "INSTANCE" && "children" in layer) {
				for (const kid of [...layer.children]) slot.appendChild(kid);
			}
			note.removed(layer);
			layer.remove();
			slot.name = s.layer;
			note.created(slot);
			made.push(c);
		}
		if (made.length === 0) {
			note.warn(
				"SLOT_LAYER_NOT_FOUND",
				`Ninguna variante tiene la capa «${s.layer}» del hueco «${s.name}»: el hueco no se crea.`,
			);
			continue;
		}
		shareSlot(made, s.name, { layer: s.layer });
	}
}
