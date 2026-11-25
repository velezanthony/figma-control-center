import { READ_KIND } from "#domain/catalog.ts";
import { MISSING_PAGE_SNIPPET, readHeader } from "./read-header.ts";

// Script interno (formato body), solo lectura: instancias de cada frame de primer nivel de las páginas pedidas,
// contadas por el nombre del set si el principal es una variante, y del componente si no. Con
// skipInvisibleInstanceChildren (lo oculto dentro de instancias no cuenta), que se deja como estaba al acabar.
export const INSTANCES_SCRIPT = `
${MISSING_PAGE_SNIPPET}
${readHeader(READ_KIND.instances)}
const pages = QUERY.pages.map((name) => {
	const page = figma.root.children.find((p) => p.name === name);
	if (!page) throw missingPage(name);
	return page;
});
const previous = figma.skipInvisibleInstanceChildren;
figma.skipInvisibleInstanceChildren = true;
try {
	const frames = [];
	for (const page of pages) {
		await page.loadAsync();
		for (const top of page.children) {
			if (top.type !== 'FRAME') continue;
			if (QUERY.frame !== null && top.name !== QUERY.frame) continue;
			const counts = {};
			for (const instance of top.findAllWithCriteria({ types: ['INSTANCE'] })) {
				const main = await instance.getMainComponentAsync();
				if (!main) continue;
				const name = main.parent && main.parent.type === 'COMPONENT_SET' ? main.parent.name : main.name;
				counts[name] = (counts[name] ?? 0) + 1;
			}
			frames.push({ page: page.name, frameId: top.id, frameName: top.name, counts });
		}
	}
	return { frames };
} finally {
	figma.skipInvisibleInstanceChildren = previous;
}`;
