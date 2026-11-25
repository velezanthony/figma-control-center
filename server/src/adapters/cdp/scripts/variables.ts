import { READ_KIND } from "#domain/catalog.ts";
import { LOCATE_NODE_SNIPPET } from "./locate-node.ts";
import { readHeader } from "./read-header.ts";

// Script interno (formato body), solo lectura: colecciones locales con modos, valores por modo y alias resueltos a un
// nivel (id + nombre, null si la variable es remota y no se conoce). Con `nodeId`, solo las variables ligadas en ese
// subárbol y dónde (`bindings`).
export const VARIABLES_SCRIPT = `
${LOCATE_NODE_SNIPPET}
${readHeader(READ_KIND.variables)}
const local = await figma.variables.getLocalVariablesAsync();
const byId = new Map(local.map((v) => [v.id, v]));
const isAlias = (v) => v !== null && typeof v === 'object' && v.type === 'VARIABLE_ALIAS';
const nameOf = async (id) => {
	const known = byId.get(id);
	if (known) return known.name;
	try {
		const found = await figma.variables.getVariableByIdAsync(id);
		return found ? found.name : null;
	} catch (e) {
		return null;
	}
};
const valueOf = async (v) => (isAlias(v) ? { alias: { id: v.id, name: await nameOf(v.id) } } : v);
let wanted = null;
let bindings;
if (QUERY.nodeId !== null) {
	const root = await locate(QUERY.nodeId);
	const nodes = 'findAll' in root ? [root, ...root.findAll()] : [root];
	bindings = [];
	const collect = (nodeId, field, bound) => {
		if (isAlias(bound)) bindings.push({ nodeId, field, variableId: bound.id });
		else if (Array.isArray(bound)) for (const item of bound) collect(nodeId, field, item);
		else if (bound !== null && typeof bound === 'object') {
			for (const [key, item] of Object.entries(bound)) collect(nodeId, field + '.' + key, item);
		}
	};
	for (const node of nodes) {
		for (const [field, bound] of Object.entries(node.boundVariables ?? {})) collect(node.id, field, bound);
	}
	wanted = new Set(bindings.map((b) => b.variableId));
}
const collections = [];
for (const c of await figma.variables.getLocalVariableCollectionsAsync()) {
	if (QUERY.collection !== null && c.name !== QUERY.collection) continue;
	const variables = [];
	for (const id of c.variableIds) {
		const v = byId.get(id);
		if (!v || (wanted !== null && !wanted.has(id))) continue;
		const valuesByMode = {};
		for (const [mode, value] of Object.entries(v.valuesByMode)) valuesByMode[mode] = await valueOf(value);
		variables.push({ id: v.id, name: v.name, resolvedType: v.resolvedType, scopes: [...v.scopes], description: v.description ?? '', valuesByMode });
	}
	if (wanted !== null && variables.length === 0) continue;
	collections.push({ id: c.id, name: c.name, modes: c.modes.map((m) => ({ id: m.modeId, name: m.name })), defaultModeId: c.defaultModeId, variables });
}
return bindings === undefined ? { collections } : { collections, bindings };`;
