import { AREA_KEY_PREFIX } from "#domain/areas.ts";
import { READ_KIND } from "#domain/catalog.ts";
import { SHEET_KEY_PREFIX } from "#domain/component-plan.ts";
import { COMPOSE_KEY_PREFIX } from "#domain/compose.ts";
import {
	COMPONENT_KIND,
	NODE_KEY_FIELD,
	NODE_KEY_NAMESPACE,
	ORIGIN_KIND,
} from "#domain/design-context.ts";
import { SCREEN_KEY_PREFIX } from "#domain/screen-plan.ts";
import { LOCATE_NODE_SNIPPET } from "./locate-node.ts";
import { PROPERTY_DEFINITIONS_SNIPPET, readHeader } from "./read-header.ts";

// Prefijo de clave `fcc:` → de qué es el nodo (el orden da igual: ninguno es prefijo de otro)
const ORIGIN_PREFIXES = [
	[AREA_KEY_PREFIX, ORIGIN_KIND.area],
	[SCREEN_KEY_PREFIX, ORIGIN_KIND.screen],
	[SHEET_KEY_PREFIX, ORIGIN_KIND.sheet],
	[COMPOSE_KEY_PREFIX, ORIGIN_KIND.compose],
] as const;

// Script interno (formato body), solo lectura: el nodo pedido como una lista plana de
// nodos en anchura (padre antes que hijos) con auto-layout, valores ligados a variables o estilos, texto e instancias.
//  - No baja dentro de una instancia salvo en sus huecos (SLOT); sus cambios van en `overridden`.
//  - Las variables y los estilos se resuelven una vez por id; las propiedades de un componente, una vez por componente.
//  - Con un set como raíz recorre solo una variante (la pedida o la por defecto, R-3); una que no existe vuelve como
//    `unknownVariant` con las opciones válidas, y el servidor la convierte en un error de contrato.
// Devuelve el DesignRead de domain/design-context.ts (sin el mapeo a código, que es del servidor).
export const DESIGN_CONTEXT_SCRIPT = `
${readHeader(READ_KIND.designContext)}
${LOCATE_NODE_SNIPPET}
${PROPERTY_DEFINITIONS_SNIPPET}
const NS = ${JSON.stringify(NODE_KEY_NAMESPACE)};
const KEY = ${JSON.stringify(NODE_KEY_FIELD)};
const SET = ${JSON.stringify(COMPONENT_KIND.set)};
const SHEET_PREFIX = ${JSON.stringify(SHEET_KEY_PREFIX)};
const ORIGINS = ${JSON.stringify(ORIGIN_PREFIXES)};
const STYLE_KIND = { TEXT: 'text', PAINT: 'paint', EFFECT: 'effect', GRID: 'grid' };
const MIXED = figma.mixed;
const MAX_ALIAS_DEPTH = 10;

// Lo que se guarda tiene que ser JSON: sin símbolos (figma.mixed) ni funciones
const plain = (value) => JSON.parse(JSON.stringify(value === undefined ? null : value));
const stripId = (name) => name.split('#')[0];

const variables = {};
const styles = {};
const components = {};
const collectionNames = new Map();

const collectionName = async (id) => {
	if (!collectionNames.has(id)) {
		const collection = await figma.variables.getVariableCollectionByIdAsync(id);
		collectionNames.set(id, collection ? { name: collection.name, mode: collection.defaultModeId } : { name: '', mode: '' });
	}
	return collectionNames.get(id);
};

// La variable por su id, con el valor en el modo por defecto de su colección y los alias seguidos hasta el valor
const variableRef = async (id) => {
	if (variables[id]) return id;
	const variable = await figma.variables.getVariableByIdAsync(id);
	if (!variable) return null;
	const collection = await collectionName(variable.variableCollectionId);
	let value = variable.valuesByMode[collection.mode];
	const aliasOf = [];
	let current = variable;
	while (value && value.type === 'VARIABLE_ALIAS' && aliasOf.length < MAX_ALIAS_DEPTH) {
		const next = await figma.variables.getVariableByIdAsync(value.id);
		if (!next) break;
		const nextCollection = await collectionName(next.variableCollectionId);
		aliasOf.push(next.name);
		value = next.valuesByMode[nextCollection.mode];
		current = next;
	}
	variables[id] = {
		name: variable.name,
		collection: collection.name,
		type: variable.resolvedType,
		value: plain(value === undefined ? '' : value),
		...(aliasOf.length > 0 && { aliasOf }),
	};
	return id;
};

const styleValue = (style) => {
	if (style.type === 'TEXT') return { fontName: style.fontName, fontSize: style.fontSize, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, textCase: style.textCase };
	if (style.type === 'PAINT') return style.paints;
	if (style.type === 'EFFECT') return style.effects;
	return style.layoutGrids;
};

const styleRef = async (id) => {
	if (styles[id]) return id;
	const style = await figma.getStyleByIdAsync(id);
	if (!style) return null;
	styles[id] = { name: style.name, kind: STYLE_KIND[style.type] ?? 'paint', key: style.key ?? '', value: plain(styleValue(style)) };
	return id;
};

// Un número del nodo: ligado a una variable o suelto
const numberValue = async (node, fields, raw) => {
	const bound = node.boundVariables ?? {};
	for (const field of fields) {
		const alias = bound[field];
		if (alias && alias.id) {
			const id = await variableRef(alias.id);
			if (id) return { variable: id };
		}
	}
	return { raw };
};

const paintValues = async (node, field, styleField) => {
	const styleId = node[styleField];
	if (styleId && styleId !== MIXED) {
		const id = await styleRef(styleId);
		if (id) return [{ style: id }];
	}
	const paints = node[field];
	if (paints === MIXED) return [{ raw: 'mixed' }];
	if (!Array.isArray(paints)) return undefined;
	const out = [];
	for (const paint of paints) {
		if (paint.visible === false) continue;
		const alias = paint.boundVariables && paint.boundVariables.color;
		const id = alias && alias.id ? await variableRef(alias.id) : null;
		out.push(id ? { variable: id } : { raw: plain(paint) });
	}
	return out.length > 0 ? out : undefined;
};

const effectValues = async (node) => {
	if (node.effectStyleId && node.effectStyleId !== MIXED) {
		const id = await styleRef(node.effectStyleId);
		if (id) return [{ style: id }];
	}
	if (!Array.isArray(node.effects) || node.effects.length === 0) return undefined;
	return node.effects.map((effect) => ({ raw: plain(effect) }));
};

const measure = (value) => (value && value !== MIXED ? plain(value) : { unit: 'AUTO' });
const fontOf = (source, node) => {
	const name = source.fontName && source.fontName !== MIXED ? source.fontName : node.fontName !== MIXED ? node.fontName : { family: '', style: '' };
	const size = typeof source.fontSize === 'number' ? source.fontSize : typeof node.fontSize === 'number' ? node.fontSize : 0;
	return { family: name.family, style: name.style, size, lineHeight: measure(source.lineHeight ?? node.lineHeight), letterSpacing: measure(source.letterSpacing ?? node.letterSpacing) };
};

const textOf = async (node) => {
	const segments = node.getStyledTextSegments(['fontName', 'fontSize', 'lineHeight', 'letterSpacing']);
	const out = { characters: node.characters, font: fontOf(segments[0] ?? node, node) };
	if (node.textStyleId && node.textStyleId !== MIXED) {
		const id = await styleRef(node.textStyleId);
		if (id) out.style = id;
	}
	if (segments.length > 1) out.segments = segments.map((s) => ({ start: s.start, end: s.end, font: fontOf(s, node) }));
	return out;
};

const hasAutoLayout = (node) => node.layoutMode !== undefined && node.layoutMode !== 'NONE';

const layoutOf = async (node) => {
	const padding = [];
	for (const side of ['Top', 'Right', 'Bottom', 'Left']) padding.push(await numberValue(node, ['padding' + side], node['padding' + side]));
	const out = {
		mode: node.layoutMode,
		wrap: node.layoutWrap === 'WRAP',
		gap: await numberValue(node, ['itemSpacing'], node.itemSpacing),
		padding,
		primaryAlign: node.primaryAxisAlignItems,
		counterAlign: node.counterAxisAlignItems,
	};
	if (out.wrap && typeof node.counterAxisSpacing === 'number') out.counterGap = await numberValue(node, ['counterAxisSpacing'], node.counterAxisSpacing);
	return out;
};

const limits = (a, b) => {
	const out = {};
	if (typeof a === 'number') out.w = a;
	if (typeof b === 'number') out.h = b;
	return out;
};

const placementOf = (node) => {
	const out = { sizing: { h: node.layoutSizingHorizontal ?? 'FIXED', v: node.layoutSizingVertical ?? 'FIXED' } };
	if (node.layoutPositioning === 'ABSOLUTE') out.positioning = 'ABSOLUTE';
	const min = limits(node.minWidth, node.minHeight);
	const max = limits(node.maxWidth, node.maxHeight);
	if (Object.keys(min).length > 0) out.min = min;
	if (Object.keys(max).length > 0) out.max = max;
	return out;
};

const radiusOf = async (node) => {
	if (!('topLeftRadius' in node)) return undefined;
	const corners = {
		tl: await numberValue(node, ['topLeftRadius'], node.topLeftRadius),
		tr: await numberValue(node, ['topRightRadius'], node.topRightRadius),
		br: await numberValue(node, ['bottomRightRadius'], node.bottomRightRadius),
		bl: await numberValue(node, ['bottomLeftRadius'], node.bottomLeftRadius),
	};
	return Object.values(corners).every((c) => c.raw === 0) ? undefined : corners;
};

// Quién guarda un nodo por clave de hoja
const sheetKeyOf = (node) => {
	const key = node.getSharedPluginData(NS, KEY);
	return key.startsWith(SHEET_PREFIX) ? key.slice(SHEET_PREFIX.length) : undefined;
};

const originOf = (node) => {
	let top = node;
	while (top.parent && top.parent.type !== 'PAGE' && top.parent.type !== 'DOCUMENT') top = top.parent;
	for (const candidate of top === node ? [node] : [node, top]) {
		const key = candidate.getSharedPluginData(NS, KEY);
		for (const [prefix, kind] of ORIGINS) {
			if (key.startsWith(prefix)) return { kind, key: key.slice(prefix.length) };
		}
	}
	return undefined;
};

// El componente (set o suelto) una sola vez: sus variantes y propiedades salen de sus definiciones
const registerComponent = async (owner) => {
	const key = owner.key || owner.id;
	if (components[key]) return key;
	let page = owner;
	while (page && page.type !== 'PAGE') page = page.parent;
	if (page) await page.loadAsync();
	const variants = {};
	const properties = [];
	for (const [name, def] of Object.entries(propertyDefinitionsOf(owner))) {
		if (def.type === 'VARIANT') variants[name] = [...(def.variantOptions ?? [])];
		else properties.push({ name: stripId(name), type: def.type, default: def.defaultValue ?? null });
	}
	const sheet = sheetKeyOf(owner);
	components[key] = { name: owner.name, kind: owner.type, key, remote: owner.remote === true, variants, properties, ...(sheet !== undefined && { sheet }) };
	return key;
};

// Lo que esta instancia cambió: «campo» de la propia instancia o «capa.campo» de una capa de dentro
const overriddenOf = async (instance) => {
	const out = [];
	for (const entry of instance.overrides) {
		let label = '';
		if (entry.id !== instance.id) {
			const layer = await figma.getNodeByIdAsync(entry.id);
			if (!layer) continue;
			label = layer.name + '.';
		}
		for (const field of entry.overriddenFields) if (!out.includes(label + field)) out.push(label + field);
	}
	return out;
};

const instanceOf = async (node) => {
	const main = await node.getMainComponentAsync();
	if (!main) return undefined;
	const owner = main.parent && main.parent.type === SET ? main.parent : main;
	const component = await registerComponent(owner);
	const props = {};
	for (const [name, prop] of Object.entries(node.componentProperties)) {
		if (prop.type !== 'VARIANT') props[stripId(name)] = prop.value;
	}
	return { component, variant: plain(main.variantProperties ?? {}), props, overridden: await overriddenOf(node) };
};

// Los huecos de una instancia, que sí se recorren (con findAll si la pestaña no admite SLOT como criterio)
const slotsOf = (instance) => {
	try {
		return instance.findAllWithCriteria({ types: ['SLOT'] });
	} catch (e) {
		return instance.findAll((n) => n.type === 'SLOT');
	}
};

const describeNode = async (node, parent) => {
	const inLayout = node.parent && hasAutoLayout(node.parent);
	const fills = await paintValues(node, 'fills', 'fillStyleId');
	const strokes = await paintValues(node, 'strokes', 'strokeStyleId');
	const weight = node.strokeWeight === MIXED ? node.strokeTopWeight : node.strokeWeight;
	const effects = await effectValues(node);
	const radius = await radiusOf(node);
	const instance = node.type === 'INSTANCE' ? await instanceOf(node) : undefined;
	return {
		id: node.id,
		parent,
		name: node.name,
		type: node.type,
		visible: node.visible,
		box: { x: node.x, y: node.y, w: node.width, h: node.height },
		...(hasAutoLayout(node) && { layout: await layoutOf(node) }),
		...((hasAutoLayout(node) || inLayout) && { placement: placementOf(node) }),
		...(fills && { fills }),
		...(strokes && { strokes }),
		...(strokes && typeof weight === 'number' && { strokeWeight: await numberValue(node, ['strokeTopWeight', 'strokeWeight'], weight) }),
		...(effects && { effects }),
		...(radius && { radius }),
		...(typeof node.opacity === 'number' && node.opacity !== 1 && { opacity: node.opacity }),
		...(node.type === 'TEXT' && { text: await textOf(node) }),
		...(instance && { instance }),
	};
};

const root = await locate(QUERY.nodeId);
const nodes = [];
const queue = [];
if (root.type === SET) {
	await registerComponent(root);
	const wanted = QUERY.variant ? Object.entries(QUERY.variant) : [];
	const chosen = wanted.length === 0
		? root.defaultVariant
		: root.children.find((c) => wanted.every(([prop, value]) => c.variantProperties && c.variantProperties[prop] === value));
	if (!chosen) return { unknownVariant: { variants: components[root.key || root.id].variants } };
	nodes.push(await describeNode(root, null));
	queue.push({ node: chosen, parent: root.id });
} else {
	queue.push({ node: root, parent: null });
}
let truncated;
while (queue.length > 0) {
	if (nodes.length >= QUERY.maxNodes) {
		truncated = { reason: 'max-nodes', children: queue.map((q) => q.node.id) };
		break;
	}
	const { node, parent } = queue.shift();
	nodes.push(await describeNode(node, parent));
	const children = node.type === 'INSTANCE' ? slotsOf(node) : 'children' in node ? node.children : [];
	for (const child of children) queue.push({ node: child, parent: node.id });
}
const origin = originOf(root);
return { fileName: figma.root.name, root: root.id, ...(origin && { origin }), nodes, variables, styles, components, ...(truncated && { truncated }) };`;
