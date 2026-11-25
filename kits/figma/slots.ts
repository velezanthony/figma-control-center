// Slots: el contenido entra como un CLON al final (una instancia con texto editado movida a un slot deja capas
// «inexistentes»), y un slot común a varias variantes comparte una sola propiedad. `setProperties` no toca slots
import { fail, note } from "./core.ts";
import type {
	ComponentNode,
	ComponentSetNode,
	InstanceNode,
	SceneNode,
} from "./types.ts";

type SlotRefs = { slotContentId?: string };

const slotRef = (slot: SceneNode): string | undefined =>
	(slot.componentPropertyReferences as SlotRefs | null)?.slotContentId;

const slotsIn = (node: InstanceNode | ComponentNode) =>
	node.findAllWithCriteria({ types: ["SLOT"] });

export function fillSlot(
	instance: InstanceNode,
	content: SceneNode,
	options: { slot?: string } = {},
): SceneNode {
	const slots = slotsIn(instance);
	const slot =
		options.slot === undefined
			? slots[0]
			: slots.find((s) => s.name === options.slot);
	if (slot === undefined) {
		return fail(
			"SLOT_NOT_FOUND",
			`La instancia «${instance.name}» no tiene ${options.slot === undefined ? "ningún slot" : `el slot «${options.slot}»`}.`,
			"Mira las propiedades SLOT del componente con figma_components.",
		);
	}
	const copy = content.clone();
	slot.appendChild(copy);
	note.created(copy);
	note.mutated(instance);
	return copy;
}

// Deja a las variantes (de un mismo set) con un solo slot y una sola propiedad SLOT llamada `key`. Devuelve su clave. Con
// `layer`, el slot de cada variante es el que se llama así (varios huecos en un mismo componente)
export function shareSlot(
	variants: readonly ComponentNode[],
	key: string,
	options: { layer?: string } = {},
): string {
	const first = variants[0];
	const set = first?.parent;
	if (first === undefined || set?.type !== "COMPONENT_SET") {
		return fail(
			"SLOT_SHARE_SET",
			"Las variantes de un slot común tienen que ser de un mismo set de componentes.",
			"Pasa las variantes (COMPONENT) de un set.",
		);
	}
	const slots = variants.map((variant) => {
		const own = slotsIn(variant);
		const existing =
			options.layer === undefined
				? own[0]
				: own.find((slot) => slot.name === options.layer);
		if (existing !== undefined) return existing;
		return note.created(variant.createSlot());
	});
	const definitions = (set as ComponentSetNode).componentPropertyDefinitions;
	let common = Object.keys(definitions).find(
		(name) => definitions[name]?.type === "SLOT" && name.split("#")[0] === key,
	);
	if (common === undefined) {
		const own = slotRef(slots[0] as SceneNode);
		if (own === undefined) {
			return fail(
				"SLOT_NO_PROPERTY",
				"El slot recién creado no tiene propiedad.",
				"Comprueba el slot en el componente.",
			);
		}
		common = (set as ComponentSetNode).editComponentProperty(own, {
			name: key,
		});
	}
	for (const slot of slots) {
		const old = slotRef(slot);
		if (old === common) continue;
		slot.componentPropertyReferences = {
			slotContentId: common,
		} as unknown as typeof slot.componentPropertyReferences;
		const stillUsed = slots.some((s) => slotRef(s) === old);
		if (old !== undefined && !stillUsed) {
			(set as ComponentSetNode).deleteComponentProperty(old);
		}
		note.mutated(slot);
	}
	return common;
}
