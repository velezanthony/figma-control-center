// kit.sheet.paint: el plan de una hoja (component@1) → su página con cabecera, tarjeta y set, en el archivo abierto. Lo llama el
// paso `kit/build-component@1` y cualquier script del proyecto que quiera pintar un plan por su cuenta. Si la hoja ya existe, la
// rehace sobre el mismo set (rebuild.ts) en vez de crear otro.
import { figmaApi, note } from "../core.ts";
import type { Ctx } from "../screen/ctx.ts";
import type { ComponentSetNode, FrameNode, PageNode } from "../types.ts";
import { loadSheetFonts, paintHeader, resolveStyle } from "./header.ts";
import { createMatrixFrame, layOutMatrix } from "./matrix.ts";
import { findSheetPage, isScratch, sheetPage } from "./page.ts";
import { addProperties, baseName, handMadeKeys } from "./properties.ts";
import {
	type Counts,
	checkRebuild,
	keptProperties,
	locateSet,
	type Outside,
	oldFrames,
	outsideInstances,
	rebuildSet,
	removeOld,
} from "./rebuild.ts";
import { buildSet, type SetVariant } from "./set.ts";
import { addSlots } from "./slots.ts";
import type { ComponentPlan } from "./types.ts";
import {
	createSheetCtx,
	type PaintedVariant,
	paintVariants,
	refuseForeignVariants,
	variantName,
} from "./variants.ts";

export type SheetCounts = {
	variants: Counts;
	properties: Counts;
	// instancias del set fuera de la página de la hoja, antes y después
	outside: { before: number; after: number };
	overrides: { before: number; after: number };
};

export type SheetPainted = {
	page: PageNode;
	head: FrameNode;
	card: FrameNode;
	matrixFrame: FrameNode;
	set: ComponentSetNode;
	variants: SetVariant[];
	// los nombres de las propiedades que este paso creó
	properties: string[];
	// si la hoja ya existía y se rehizo sobre su set
	rebuilt: boolean;
	counts: SheetCounts;
	ctx: Ctx;
};

// Con `map`, las variantes de la web llevan además esos valores (para las props que solo tiene Figma): así se emparejan con las
// de Figma y las nuevas se crean con ellos en el nombre
function withMapped(
	painted: PaintedVariant[],
	values: Readonly<Record<string, string>> | undefined,
): PaintedVariant[] {
	if (values === undefined) return painted;
	return painted.map((p) => {
		const props = { ...p.props, ...values };
		p.component.name = variantName(props);
		return { props, component: p.component };
	});
}

const NONE: Outside = { count: 0, overrides: 0 };

// Corre `paint` y, si lanza, quita los nodos de primer nivel que aparecieron en esas páginas desde antes de empezar
async function withoutLeftovers<T>(
	pages: readonly PageNode[],
	paint: () => Promise<T>,
): Promise<T> {
	const seen = new Set(pages.flatMap((p) => p.children.map((c) => c.id)));
	try {
		return await paint();
	} catch (e) {
		for (const p of new Set(pages))
			for (const c of [...p.children])
				if (!seen.has(c.id) && !c.removed) c.remove();
		throw e;
	}
}

export async function paintSheet(
	plan: ComponentPlan,
	assets: Readonly<Record<string, Uint8Array>>,
	// recognize@1: el módulo del proyecto como objeto (o null)
	recognize?: unknown,
	options: {
		// el set que ya se localizó (assessSheet): evita buscarlo otra vez
		existing?: { set: ComponentSetNode | null; adopted: boolean };
		// decisión `map`: valores que se añaden a las props de las variantes de la web
		mapValues?: Readonly<Record<string, string>>;
	} = {},
): Promise<SheetPainted> {
	// Todo lo que falta en Figma (colecciones, fuentes, variables de `style`, módulo mal formado) para el paso AQUÍ
	const ctx = await createSheetCtx(plan, assets, recognize);
	await loadSheetFonts(plan);
	const vars = resolveStyle(ctx, plan);
	// Dónde está la hoja, sin escribir nada; lo que no cuadra con lo que hay (propiedades a mano, tipos) para el paso aquí
	const found = await findSheetPage(plan);
	const existing =
		options.existing ??
		(isScratch(plan)
			? { set: null, adopted: false }
			: await locateSet(plan, found.page));
	if (existing.set !== null) checkRebuild(plan, existing.set);
	const old = existing.set;
	const page = await sheetPage(plan, found, old !== null);
	const before = old === null ? NONE : await outsideInstances(old, page);
	const beforeKeys = new Set(old === null ? [] : handMadeKeys(old));
	const leftovers = old === null ? [] : oldFrames(old, page, plan);

	// Si el pintado falla a medias, se quita lo que dejó suelto (cabecera, tarjeta, variantes y marcos) antes de tocar el set
	const { head, card, raw } = await withoutLeftovers(
		[page, figmaApi().currentPage],
		async () => ({
			...paintHeader(plan, vars, page),
			raw: await paintVariants(ctx, plan, page),
		}),
	);
	// Antes de tocar el set que existe: ninguna variante puede ser solo otro componente
	await refuseForeignVariants(plan, raw, [head, card]);
	const painted = withMapped(raw, options.mapValues);
	const matrixFrame = createMatrixFrame(plan, card);
	let set: ComponentSetNode;
	let variants: SetVariant[];
	let variantCounts: Counts;
	if (old === null) {
		({ set, variants } = buildSet(plan, painted, matrixFrame));
		variantCounts = { created: variants.length, updated: 0, kept: 0 };
	} else {
		set = old;
		({ variants, counts: variantCounts } = await rebuildSet(
			plan,
			old,
			existing.adopted,
			painted,
			matrixFrame,
			page,
		));
		removeOld(leftovers);
	}
	addSlots(plan, variants);
	layOutMatrix(plan, vars, { matrix: matrixFrame, set, variants, card, head });
	const { updated } = addProperties(ctx, plan, set, variants);
	const keptCount = keptProperties(plan, set);
	// El contenido diferido de los huecos (celdas) entra al final
	ctx.recognizer?.flush();
	note.created(matrixFrame);
	// Encuadrar la cabecera y la tarjeta; Figma recalcula así lo que las propiedades ocultaron
	figmaApi().viewport.scrollAndZoomIntoView([head, card]);
	const created = handMadeKeys(set)
		.filter((k) => !beforeKeys.has(k))
		.map(baseName);
	const after = old === null ? NONE : await outsideInstances(set, page);
	return {
		page,
		head,
		card,
		matrixFrame,
		set,
		variants,
		properties: created,
		rebuilt: old !== null,
		counts: {
			variants: variantCounts,
			properties: {
				created: created.length,
				updated: updated.length,
				kept: keptCount,
			},
			outside: { before: before.count, after: after.count },
			overrides: { before: before.overrides, after: after.overrides },
		},
		ctx,
	};
}

export type { ComponentPlan } from "./types.ts";
