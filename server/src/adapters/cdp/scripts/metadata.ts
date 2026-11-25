import { LOCATE_NODE_SNIPPET } from "./locate-node.ts";

// Script interno (formato body): árbol ligero { id, name, type, children? } hasta `depth` niveles
export const metadataScript = (
	nodeId: string | null,
	depth: number,
): string => `
${LOCATE_NODE_SNIPPET}
const NODE_ID = ${JSON.stringify(nodeId)};
const DEPTH = ${JSON.stringify(depth)};
const root = NODE_ID === null ? figma.currentPage : await locate(NODE_ID);
const walk = (n, d) => {
	const base = { id: n.id, name: n.name, type: n.type };
	return d > 0 && 'children' in n ? { ...base, children: n.children.map((c) => walk(c, d - 1)) } : base;
};
return walk(root, DEPTH);`;
