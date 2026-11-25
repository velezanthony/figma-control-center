// Páginas: por nombre recortado o por clave (la página abierta no se puede borrar)
import { fail, figmaApi, note } from "./core.ts";
import { KEY, NS, type PageNode } from "./types.ts";

export async function findPage(name: string): Promise<PageNode | null> {
	const wanted = name.trim();
	const page = figmaApi().root.children.find((p) => p.name.trim() === wanted);
	if (page === undefined) return null;
	await page.loadAsync();
	return page;
}

// La página de esa clave; si no hay, la que se llama así (y se le pone la clave); si tampoco, una nueva
export async function ensurePage(options: {
	key: string;
	name: string;
}): Promise<PageNode> {
	const f = figmaApi();
	for (const page of f.root.children) {
		await page.loadAsync();
		if (page.getSharedPluginData(NS, KEY) === options.key) return page;
	}
	const byName = await findPage(options.name);
	if (byName !== null) {
		byName.setSharedPluginData(NS, KEY, options.key);
		note.mutated(byName);
		return byName;
	}
	const page = f.createPage();
	page.name = options.name;
	page.setSharedPluginData(NS, KEY, options.key);
	note.created(page);
	return page;
}

// Borrar la página abierta lanza: antes se pasa a otra
export async function removePage(page: PageNode): Promise<void> {
	const f = figmaApi();
	if (f.currentPage.id === page.id) {
		const other = f.root.children.find((p) => p.id !== page.id);
		if (other === undefined) {
			fail(
				"LAST_PAGE",
				`«${page.name}» es la única página del archivo y no se puede borrar.`,
				"Crea otra página antes de borrar ésta.",
			);
		}
		await f.setCurrentPageAsync(other);
	}
	const id = page.id;
	page.remove();
	note.removed(id);
}
