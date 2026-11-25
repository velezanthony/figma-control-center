// Cada variante capturada, pintada con el pintor de pantallas (un `ctx` común: fuentes, variables e iconos se cargan una vez) y
// convertida en componente. El plan de la hoja se ve como el de una pantalla; entre variante y variante
// cambian sus raíces y sus props, que es lo que el reconocimiento mira.
import { fail, figmaApi, note } from "../core.ts";
import { type Ctx, createCtx } from "../screen/ctx.ts";
import { paintRoots } from "../screen/roots.ts";
import type { PlanNode, ScreenPlan } from "../screen/types.ts";
import { pageOf } from "../tree.ts";
import type { ComponentNode, PageNode, SceneNode } from "../types.ts";
import { flowIcons } from "./flow-icons.ts";
import type { ComponentPlan } from "./types.ts";

export type PaintedVariant = {
	props: Record<string, string>;
	component: ComponentNode;
};

// La hoja como un screen@1 para el pintor: todas las raíces juntas para cargar las fuentes y, sin reglas propias, sin
// reconocerse a sí misma
export function screenView(plan: ComponentPlan): ScreenPlan {
	const own = plan.sheet.title.toLowerCase();
	return {
		contract: "screen@1",
		screen: plan.sheet.screen,
		title: plan.sheet.title,
		variant: 0,
		props: {},
		sources: {
			capture: plan.sources.capture,
			map: plan.sources.map,
			...(plan.sources.recognize !== undefined && {
				recognize: plan.sources.recognize,
			}),
		},
		target: {
			page: { name: plan.target.page.name, key: plan.target.page.key },
			frame: { name: plan.target.set.name, key: plan.target.set.key },
		},
		root: plan.variants.flatMap((v) => v.root),
		images: plan.images,
		icons: plan.icons,
		map: plan.map,
		...(plan.fingerprints !== undefined && {
			fingerprints: plan.fingerprints,
		}),
		...(plan.rules !== undefined && {
			rules: plan.rules.filter((r) => r.toLowerCase() !== own),
		}),
		warnings: plan.warnings,
	};
}

export async function createSheetCtx(
	plan: ComponentPlan,
	assets: Readonly<Record<string, Uint8Array>>,
	recognize: unknown,
): Promise<Ctx> {
	const ctx = await createCtx(screenView(plan), assets, recognize ?? null);
	ctx.layerNames = plan.sheet.names ?? [];
	ctx.ownTitle = plan.sheet.title;
	if (plan.sheet.flowIcons === true) {
		for (const v of plan.variants) for (const n of v.root) flowIcons(n);
	}
	return ctx;
}

export const variantName = (props: Readonly<Record<string, string>>): string =>
	Object.entries(props)
		.map(([k, v]) => `${k}=${v}`)
		.join(", ");

export async function paintVariants(
	ctx: Ctx,
	plan: ComponentPlan,
	page: PageNode,
): Promise<PaintedVariant[]> {
	const f = figmaApi();
	const out: PaintedVariant[] = [];
	for (const variant of plan.variants) {
		ctx.plan.root = variant.root as PlanNode[];
		ctx.plan.props = variant.props;
		const root = await paintRoots(ctx);
		page.appendChild(root);
		// Medido (H1, sin verificar): el componente que devuelve puede ser otro nodo; siempre se sigue el que devuelve
		const component = f.createComponentFromNode(root);
		component.name = variantName(variant.props);
		out.push({ props: variant.props, component });
	}
	return out;
}

// Guarda: una variante pintada que es solo una instancia de otro componente es un fallo del constructor (la hoja
// se convertiría en ese otro). Se quita lo pintado y el paso falla antes de tocar el set que existe. Los iconos del catálogo
// no cuentan (un botón de solo icono es legítimo)
export async function refuseForeignVariants(
	plan: ComponentPlan,
	painted: readonly PaintedVariant[],
	alsoRemove: readonly SceneNode[],
): Promise<void> {
	const own = plan.sheet.title.trim().toLowerCase();
	const iconPages = new RegExp(plan.map.icons.pages);
	const bad: string[] = [];
	for (const p of painted) {
		const kids = p.component.children.filter((c) => c.visible);
		const only = kids[0];
		if (kids.length !== 1 || only === undefined || only.type !== "INSTANCE")
			continue;
		const main = await only.getMainComponentAsync();
		if (main === null || iconPages.test(pageOf(main)?.name ?? "")) continue;
		const name =
			main.parent?.type === "COMPONENT_SET" ? main.parent.name : main.name;
		if (name.trim().toLowerCase() === own) continue;
		bad.push(`«${p.component.name}» es solo una instancia de «${name.trim()}»`);
	}
	if (bad.length === 0) return;
	for (const n of [...painted.map((p) => p.component), ...alsoRemove]) {
		note.removed(n);
		if (!n.removed) n.remove();
	}
	fail(
		"SHEET_ROOT_IS_OTHER",
		`La hoja «${plan.sheet.key}» no se escribe: ${bad.join("; ")}. La captura se reconoció como otro componente.`,
		"Revisa las huellas (fingerprints) y `rules` de la hoja, o la captura de la pantalla, y repite el paso.",
	);
}
