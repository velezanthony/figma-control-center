import { LOCATE_NODE_SNIPPET } from "./locate-node.ts";

// Script interno (formato body): exporta un nodo a PNG y lo devuelve en base64
export const screenshotScript = (nodeId: string, scale: number): string => `
${LOCATE_NODE_SNIPPET}
const node = await locate(${JSON.stringify(nodeId)});
if (typeof node.exportAsync !== 'function') throw new Error('El nodo ' + node.id + ' (' + node.type + ') no se puede exportar');
const bytes = await node.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: ${JSON.stringify(scale)} } });
return { base64: figma.base64Encode(bytes) };`;
