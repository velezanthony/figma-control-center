import { EXPORT_FORMAT, READ_KIND } from "#domain/catalog.ts";
import { LOCATE_NODE_SNIPPET } from "./locate-node.ts";
import { readHeader } from "./read-header.ts";

// Formatos de mapa de bits: los únicos que admiten escala en exportAsync (ExportSettingsImage)
const RASTER = [EXPORT_FORMAT.png, EXPORT_FORMAT.jpg];

// Script interno (formato body), solo lectura: exporta cada nodo en el formato pedido y lo devuelve en base64. Primero
// localiza todos: un id que no existe falla antes de exportar ninguno.
export const EXPORT_SCRIPT = `
${LOCATE_NODE_SNIPPET}
${readHeader(READ_KIND.export)}
const RASTER = ${JSON.stringify(RASTER)};
const settings = RASTER.includes(QUERY.format)
	? { format: QUERY.format, constraint: { type: 'SCALE', value: QUERY.scale } }
	: { format: QUERY.format };
const targets = [];
for (const id of QUERY.nodeIds) targets.push(await locate(id));
const nodes = [];
for (const node of targets) {
	if (typeof node.exportAsync !== 'function') throw new Error('El nodo ' + node.id + ' (' + node.type + ') no se puede exportar');
	const bytes = await node.exportAsync(settings);
	nodes.push({ nodeId: node.id, base64: figma.base64Encode(bytes) });
}
return { nodes };`;
