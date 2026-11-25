import { NODE_NOT_FOUND_MARKER } from "../protocol.ts";

// Fragmento común de los scripts internos: busca un nodo por id y carga su página (dynamic-page)
export const LOCATE_NODE_SNIPPET = `
const locate = async (id) => {
	const node = await figma.getNodeByIdAsync(id);
	if (!node) throw new Error(${JSON.stringify(NODE_NOT_FOUND_MARKER)} + id);
	let page = node;
	while (page && page.type !== 'PAGE' && page.type !== 'DOCUMENT') page = page.parent;
	if (page && page.type === 'PAGE') await page.loadAsync();
	return node;
};`;
