// El set de variantes: las variantes se combinan dentro del marco de la matriz, con su nombre, su
// descripción y las instancias expuestas. Con la clave del set y de cada variante.

import { propsOfVariant } from "../components.ts";
import { figmaApi, note } from "../core.ts";
import { tagNode } from "../nodes.ts";
import {
	type ComponentNode,
	type ComponentSetNode,
	type FrameNode,
	SHEET_VARIANT_KEY_PREFIX,
} from "../types.ts";
import type { ComponentPlan } from "./types.ts";
import type { PaintedVariant } from "./variants.ts";
import { variantName } from "./variants.ts";

export type SetVariant = {
	index: number;
	props: Record<string, string>;
	component: ComponentNode;
};

// Expone las instancias con esos nombres. Medido (H10): Figma solo deja exponer una instancia con instancias anidadas expuestas o
// con hijos que llevan referencias de propiedad; las demás lanzan, y eso no para la hoja: se devuelven para avisar
export function exposeNamed(
	component: ComponentNode,
	names: readonly string[],
): { id: string; message: string }[] {
	const failed: { id: string; message: string }[] = [];
	for (const x of component.findAllWithCriteria({ types: ["INSTANCE"] })) {
		if (!names.includes(x.name)) continue;
		try {
			x.isExposedInstance = true;
		} catch (e) {
			failed.push({
				id: x.id,
				message: e instanceof Error ? e.message : String(e),
			});
		}
	}
	return failed;
}

// Lo que va igual en un set nuevo y en uno que se rehace: expuestos, clave de cada variante, nombre, descripción y clave del set
export function finishSet(
	plan: ComponentPlan,
	set: ComponentSetNode,
	variants: readonly SetVariant[],
	created: readonly ComponentNode[],
	fresh: boolean,
): void {
	const { sheet } = plan;
	for (const v of variants) {
		for (const f of exposeNamed(v.component, sheet.exposed ?? [])) {
			note.warn(
				"EXPOSE_FAILED",
				`No se pudo exponer «${f.id}» en «${v.component.name}»: ${f.message}`,
				f.id,
			);
		}
		tagNode(
			v.component,
			`${SHEET_VARIANT_KEY_PREFIX}${sheet.key}:${v.component.name}`,
		);
	}
	note.created(created);
	set.name = plan.target.set.name;
	const bug =
		sheet.bug === undefined
			? ""
			: `${plan.style.bug?.setPrefix ?? ""}${sheet.bug}\n\n`;
	set.description = `${bug}${sheet.description}${sheet.tag === undefined ? "" : `\n${sheet.tag}`}`;
	tagNode(set, plan.target.set.key);
	if (fresh) note.created(set);
}

export function buildSet(
	plan: ComponentPlan,
	painted: readonly PaintedVariant[],
	matrix: FrameNode,
): { set: ComponentSetNode; variants: SetVariant[] } {
	const set = figmaApi().combineAsVariants(
		painted.map((p) => p.component),
		matrix,
	);
	// H7 (medido): combinar conserva los ids de las variantes; aun así se releen las del set, por nombre
	const queue = new Map<string, ComponentNode[]>();
	for (const child of set.children) {
		if (child.type !== "COMPONENT") continue;
		queue.set(child.name, [...(queue.get(child.name) ?? []), child]);
	}
	const variants: SetVariant[] = [];
	for (const [index, p] of painted.entries()) {
		const found = queue.get(variantName(p.props))?.shift();
		if (found === undefined) continue;
		variants.push({ index, props: p.props, component: found });
	}
	finishSet(
		plan,
		set,
		variants,
		variants.map((v) => v.component),
		true,
	);
	return { set, variants };
}

export { propsOfVariant };
