// La página de la hoja: por clave; si no, por nombre recortado (se adopta y avisa ADOPTED); si no,
// nueva, tras la que dice `after` o al final de su sección, nunca arriba del todo. Una página de verdad que ya tiene la hoja se
// rehace (rebuild.ts); con contenido que no es la hoja no se repinta; la aparte (scratch) se vacía y se vuelve a pintar.
import { fail, figmaApi, note } from "../core.ts";
import { tagNode } from "../nodes.ts";
import { findPage } from "../pages.ts";
import { KEY, NS, type PageNode, SHEET_SCRATCH_KEY_PREFIX } from "../types.ts";
import type { ComponentPlan } from "./types.ts";

const INDENTED = /^\s/;

const byKey = async (key: string): Promise<PageNode | null> => {
	for (const page of figmaApi().root.children) {
		await page.loadAsync();
		if (page.getSharedPluginData(NS, KEY) === key) return page;
	}
	return null;
};

// Dónde va una página nueva: tras `after`, o al final de su sección; sin ninguna de las dos, al final
function indexFor(target: ComponentPlan["target"]["page"]): number {
	const kids = figmaApi().root.children;
	const { after, section } = target;
	if (after !== undefined) {
		const at = kids.findIndex((p) => p.name.trim() === after.trim());
		if (at >= 0) return at + 1;
	}
	if (section !== undefined) {
		let at = kids.findIndex((p) => p.name === section);
		if (at >= 0) {
			while (at + 1 < kids.length && INDENTED.test(kids[at + 1]?.name ?? ""))
				at++;
			return at + 1;
		}
	}
	if (after !== undefined || section !== undefined) {
		note.warn(
			"PAGE_AFTER_NOT_FOUND",
			`No hay página «${after ?? section ?? ""}»: «${target.name}» queda al final.`,
		);
	}
	return kids.length;
}

export const isScratch = (plan: ComponentPlan): boolean =>
	plan.target.page.key.startsWith(SHEET_SCRATCH_KEY_PREFIX);

// La página que ya existe para la hoja, por clave o por nombre (esa se adopta), sin escribir nada
export async function findSheetPage(
	plan: ComponentPlan,
): Promise<{ page: PageNode | null; adopted: boolean }> {
	const page = await byKey(plan.target.page.key);
	if (page !== null) return { page, adopted: false };
	const named = await findPage(plan.target.page.name);
	return { page: named, adopted: named !== null };
}

export async function sheetPage(
	plan: ComponentPlan,
	found: { page: PageNode | null; adopted: boolean },
	hasSet: boolean,
): Promise<PageNode> {
	const f = figmaApi();
	const target = plan.target.page;
	const scratch = isScratch(plan);
	let { page } = found;
	if (page !== null && !scratch && !hasSet && page.children.length > 0) {
		fail(
			"SHEET_EXISTS",
			`La página «${page.name}» ya tiene contenido y ninguno de sus sets es el de la hoja «${plan.sheet.key}»: no se repinta encima.`,
			"Pinta la hoja en la página aparte (scratch) o vacía esa página a mano.",
		);
	}
	if (page === null) {
		page = f.createPage();
		page.name = target.name;
		f.root.insertChild(indexFor(target), page);
		tagNode(page, target.key);
		note.created(page);
	} else if (found.adopted) {
		tagNode(page, target.key);
		note.warn(
			"ADOPTED",
			`La página «${page.name}» no tenía clave: se adopta como la de la hoja.`,
			page.id,
		);
	}
	if (scratch) {
		const old = [...page.children];
		note.removed(old);
		for (const child of old) child.remove();
	}
	await f.setCurrentPageAsync(page);
	return page;
}
