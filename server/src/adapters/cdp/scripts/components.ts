import { COMPONENT_TYPE, READ_KIND } from "#domain/catalog.ts";
import {
	MISSING_PAGE_SNIPPET,
	PROPERTY_DEFINITIONS_SNIPPET,
	readHeader,
} from "./read-header.ts";

// Script interno (formato body), solo lectura: sets de componentes (con las opciones de cada variante y las propiedades
// que no son variante) y componentes sueltos, con su página. Las variantes de un set no salen sueltas. Un SLOT llega sin
// `defaultValue` (aunque @figma/plugin-typings lo declare siempre): sale `null`. Un set roto aborta la lectura nombrándolo.
export const COMPONENTS_SCRIPT = `
${MISSING_PAGE_SNIPPET}
${PROPERTY_DEFINITIONS_SNIPPET}
${readHeader(READ_KIND.components)}
const SET = ${JSON.stringify(COMPONENT_TYPE.set)};
const COMPONENT = ${JSON.stringify(COMPONENT_TYPE.component)};
const pages = figma.root.children;
if (QUERY.page !== null && !pages.some((p) => p.name === QUERY.page)) throw missingPage(QUERY.page);
const needle = QUERY.query === null ? null : QUERY.query.toLowerCase();
const components = [];
for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
	const page = pages[pageIndex];
	if (QUERY.page !== null && page.name !== QUERY.page) continue;
	await page.loadAsync();
	for (const node of page.findAllWithCriteria({ types: [SET, COMPONENT] })) {
		if (node.type === COMPONENT && node.parent && node.parent.type === SET) continue;
		if (needle !== null && !node.name.toLowerCase().includes(needle)) continue;
		const variants = {};
		const properties = [];
		for (const [name, def] of Object.entries(propertyDefinitionsOf(node))) {
			if (def.type === 'VARIANT') variants[name] = [...(def.variantOptions ?? [])];
			else properties.push({ name, type: def.type, defaultValue: def.defaultValue ?? null });
		}
		components.push({ id: node.id, key: node.key, name: node.name, type: node.type, page: page.name, pageIndex, description: node.description ?? '', variants, properties, variantCount: node.type === SET ? node.children.length : 0 });
	}
}
return { components };`;
