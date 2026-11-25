// Instancias con textos y «Mostrar…» ya puestos. El texto de un componente anidado se aplica a la instancia anidada que
// es dueña de la prop
import { pickVariant } from "./components.ts";
import { note } from "./core.ts";
import { ensureFonts } from "./fonts.ts";
import type { ComponentNode, ComponentSetNode, InstanceNode } from "./types.ts";

const baseName = (key: string) => key.split("#")[0] ?? key;
const SHOW_PREFIX = /^mostrar\s+/i;

type Owner = { instance: InstanceNode; key: string };

// La propiedad por su nombre sin sufijo: en la instancia o, si no, en la primera anidada que la tenga
function ownerOf(
	root: InstanceNode,
	name: string,
	type: "TEXT" | "BOOLEAN",
): Owner | null {
	const own = (instance: InstanceNode): Owner | null => {
		for (const [key, prop] of Object.entries(instance.componentProperties)) {
			if (prop.type === type && baseName(key) === name)
				return { instance, key };
		}
		return null;
	};
	const direct = own(root);
	if (direct !== null) return direct;
	for (const nested of root.findAllWithCriteria({ types: ["INSTANCE"] })) {
		const found = own(nested);
		if (found !== null) return found;
	}
	return null;
}

export async function createInstance(
	set: ComponentSetNode | ComponentNode,
	options: {
		variant?: Readonly<Record<string, string>>;
		texts?: Readonly<Record<string, string>>;
		visible?: Readonly<Record<string, boolean>>;
	} = {},
): Promise<InstanceNode> {
	const component = pickVariant(set, options.variant ?? {});
	const instance = component.createInstance();
	note.created(instance);
	await ensureFonts(instance);

	const texts = options.texts ?? {};
	for (const [name, value] of Object.entries(texts)) {
		const owner = ownerOf(instance, name, "TEXT");
		if (owner === null) {
			note.warn(
				"TEXT_PROP_NOT_FOUND",
				`«${set.name}» no tiene una propiedad de texto «${name}».`,
				instance.id,
			);
			continue;
		}
		owner.instance.setProperties({ [owner.key]: value });
	}

	// Un «Mostrar X» sin valor dado se apaga si no hay texto para X
	const visible: Record<string, boolean> = { ...(options.visible ?? {}) };
	for (const key of Object.keys(instance.componentProperties)) {
		const prop = instance.componentProperties[key];
		const name = baseName(key);
		if (prop?.type !== "BOOLEAN" || !SHOW_PREFIX.test(name)) continue;
		if (name in visible) continue;
		const target = name.replace(SHOW_PREFIX, "").trim().toLowerCase();
		const given = Object.entries(texts).find(
			([textName]) => textName.trim().toLowerCase() === target,
		);
		visible[name] = given !== undefined && given[1] !== "";
	}
	for (const [name, value] of Object.entries(visible)) {
		const owner = ownerOf(instance, name, "BOOLEAN");
		if (owner === null) {
			note.warn(
				"VISIBLE_PROP_NOT_FOUND",
				`«${set.name}» no tiene una propiedad «${name}».`,
				instance.id,
			);
			continue;
		}
		owner.instance.setProperties({ [owner.key]: value });
	}
	return instance;
}
