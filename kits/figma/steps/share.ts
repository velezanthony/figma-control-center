// kit/share@1: el contenido común a varias áreas pasa a un componente con una variante por área y
// cada frame usa una instancia. Trampas: 3 (quitar los enlaces antes de mover de página), 2 (los ids
// cambian al combinar o mover: se vuelve a leer) y 13 (una variante quitada deja huérfanas sus instancias: se rehace en su
// sitio, como una hoja).
import { fail, figmaApi, note, startTracking } from "../core.ts";
import { nodeByKey, tagNode } from "../nodes.ts";
import { ensurePage, findPage } from "../pages.ts";
import { refill } from "../sheet/rebuild.ts";
import { descendantsOfType, LINKABLE_TYPES } from "../tree.ts";
import type {
	ComponentNode,
	ComponentSetNode,
	FrameNode,
	PageNode,
	SceneNode,
} from "../types.ts";
import {
	type AreaParams,
	findAreaFrame,
	requirePage,
	type SharedData,
	sharedGroupKey,
} from "./common.ts";

type Loose = Record<string, unknown>;
const loose = (node: unknown): Loose => node as Loose;

// La página del grupo: por clave, por nombre o nueva, esta última justo tras `after`
async function groupPage(group: SharedData): Promise<PageNode> {
	const f = figmaApi();
	const before = new Set(f.root.children.map((p) => p.id));
	const page = await ensurePage({
		key: sharedGroupKey(group.name),
		name: group.page.name,
	});
	if (!before.has(page.id) && group.page.after !== undefined) {
		const after = await findPage(group.page.after);
		if (after !== null)
			f.root.insertChild(f.root.children.indexOf(after) + 1, page);
	}
	await page.loadAsync();
	return page;
}

async function groupSet(
	group: SharedData,
	page: PageNode,
): Promise<ComponentSetNode | null> {
	const byKey = await nodeByKey(sharedGroupKey(group.name), { page });
	if (byKey !== null && byKey.type === "COMPONENT_SET") return byKey;
	const byName = page.children.find(
		(c) => c.type === "COMPONENT_SET" && c.name === group.set,
	);
	if (byName === undefined || byName.type !== "COMPONENT_SET") return null;
	tagNode(byName, sharedGroupKey(group.name));
	return byName;
}

// Las reacciones de la capa y de lo que lleva dentro se quitan antes de mover
async function clearReactions(part: SceneNode): Promise<void> {
	for (const node of [part, ...descendantsOfType(part, LINKABLE_TYPES)]) {
		const reactions = loose(node)["reactions"];
		if (!Array.isArray(reactions) || reactions.length === 0) continue;
		await (
			node as unknown as { setReactionsAsync(r: unknown[]): Promise<void> }
		).setReactionsAsync([]);
		note.mutated(node);
	}
}

type Entry = {
	frame: FrameNode;
	index: number;
	component: ComponentNode;
	name: string;
};

export async function share(params: AreaParams) {
	const area = params.area;
	const tracker = startTracking();
	const areaPage = await requirePage(area);
	const report: {
		group: string;
		area: string;
		frame: string;
		variant: string;
	}[] = [];

	for (const group of params.shared) {
		const mine = group.from.filter((entry) => entry.area === area.name);
		if (mine.length === 0) continue;

		const page = await groupPage(group);
		let set = await groupSet(group, page);
		const entries: Entry[] = [];
		for (const from of mine) {
			const frame = await findAreaFrame(area, areaPage, from.frame);
			if (frame === null) {
				note.warn(
					"ALREADY_SHARED",
					`El frame «${from.frame}» no existe en «${area.page}»: no se comparte.`,
				);
				continue;
			}
			const part = frame.children.find((k) => group.part.includes(k.name));
			if (part === undefined) {
				note.warn(
					"ALREADY_SHARED",
					`«${from.frame}» ya no tiene la capa a compartir: ya está compartido.`,
					frame.id,
				);
				continue;
			}
			const index = frame.children.indexOf(part);
			const width = part.width;
			await clearReactions(part);
			page.appendChild(part);
			const mover = loose(part);
			mover["layoutGrow"] = 0;
			mover["layoutSizingHorizontal"] = "FIXED";
			(part as FrameNode).resize(width, part.height);
			mover["layoutSizingVertical"] = "HUG";
			const name = `${group.variantProp}=${from.value}`;
			const component = figmaApi().createComponentFromNode(part);
			component.name = name;
			entries.push({ frame, index, component, name });
		}
		if (entries.length === 0) continue;

		const refilled = new Set<string>();
		if (set !== null) {
			// La variante que ya existe se rehace en su sitio (mismo id): las instancias de otras páginas siguen apuntando a ella
			// y sus cambios en capas de dentro se reaplican por ruta o se avisan (OVERRIDES_LOST), como al rehacer una hoja
			for (const entry of entries) {
				const old = set.children.find((c) => c.name === entry.name);
				if (old !== undefined && old.type === "COMPONENT") {
					await refill(old, entry.component, page);
					note.mutated(old);
					refilled.add(entry.name);
					continue;
				}
				set.appendChild(entry.component);
			}
		} else {
			set = figmaApi().combineAsVariants(
				entries.map((e) => e.component),
				page,
			);
			set.name = group.set;
			if (group.sheet !== undefined) {
				set.layoutMode = "HORIZONTAL";
				set.itemSpacing = group.sheet.gap;
				set.paddingTop = group.sheet.padding;
				set.paddingBottom = group.sheet.padding;
				set.paddingLeft = group.sheet.padding;
				set.paddingRight = group.sheet.padding;
				set.counterAxisSizingMode = "AUTO";
				set.primaryAxisSizingMode = "AUTO";
				set.fills = [{ type: "SOLID", color: { r: 0.98, g: 0.98, b: 0.98 } }];
			}
			set.description = `Contenido de «${group.name}» común a varias áreas (una variante por ${group.variantProp}). Las pantallas de cada área usan una instancia.`;
			tagNode(set, sharedGroupKey(group.name));
		}

		// Los ids de las variantes pueden haber cambiado al combinar o mover (trampa 2): se leen del set, no de las referencias
		const names = new Set(
			entries.map((e) => e.name).filter((n) => !refilled.has(n)),
		);
		note.created(set.children.filter((c) => names.has(c.name)));
		for (const entry of entries) {
			const variant = set.children.find((c) => c.name === entry.name);
			if (variant === undefined || variant.type !== "COMPONENT") {
				fail(
					"VARIANT_NOT_FOUND",
					`El set «${group.set}» no tiene la variante «${entry.name}» tras compartir.`,
					"Mira el set en Figma y repite el paso.",
				);
			}
			const instance = variant.createInstance();
			entry.frame.insertChild(entry.index, instance);
			instance.layoutGrow = 1;
			instance.layoutAlign = "INHERIT";
			note.created(instance);
			note.mutated(entry.frame);
			report.push({
				group: group.name,
				area: area.name,
				frame: entry.frame.name,
				variant: entry.name,
			});
		}
	}
	return tracker.done({ shared: report });
}
