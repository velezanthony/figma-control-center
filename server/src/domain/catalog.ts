// Lo que leen las herramientas de lectura del archivo: variables, estilos, componentes, instancias
// por frame y nodos exportados. Tipos puros: los rellena el adaptador CDP y los guarda en disco el caso de uso.

// Color de Figma (RGB o RGBA, cada canal de 0 a 1)
export type CatalogColor = {
	readonly r: number;
	readonly g: number;
	readonly b: number;
	readonly a?: number;
};

// Un alias resuelto a un nivel: el id y el nombre de la variable a la que apunta (null si es remota y no se conoce)
export type VariableAliasValue = {
	readonly alias: { readonly id: string; readonly name: string | null };
};

// Lo que vale una variable en un modo. `object` cubre los valores compuestos de Figma (curvas, color con opacidad)
export type VariableModeValue =
	| boolean
	| number
	| string
	| CatalogColor
	| VariableAliasValue
	| Readonly<Record<string, unknown>>;

export type VariableEntry = {
	readonly id: string;
	readonly name: string;
	readonly resolvedType: string;
	readonly scopes: readonly string[];
	readonly description: string;
	// Por id de modo (los `modes` de su colección dan el nombre)
	readonly valuesByMode: Readonly<Record<string, VariableModeValue>>;
};

export type VariableMode = { readonly id: string; readonly name: string };

export type VariableCollection = {
	readonly id: string;
	readonly name: string;
	readonly modes: readonly VariableMode[];
	readonly defaultModeId: string;
	readonly variables: readonly VariableEntry[];
};

// Dónde está ligada una variable dentro del subárbol pedido
export type VariableBinding = {
	readonly nodeId: string;
	readonly field: string;
	readonly variableId: string;
};

export type VariablesRead = {
	readonly collections: readonly VariableCollection[];
	// Solo con `nodeId`
	readonly bindings?: readonly VariableBinding[];
};

export const STYLE_KIND = Object.freeze({
	paint: "paint",
	text: "text",
	effect: "effect",
	grid: "grid",
} as const);
export type StyleKind = (typeof STYLE_KIND)[keyof typeof STYLE_KIND];

export type StyleEntry = {
	readonly id: string;
	readonly key: string;
	readonly name: string;
	readonly kind: StyleKind;
	readonly description: string;
	readonly boundVariables: Readonly<Record<string, unknown>>;
	// Corto: las pinturas, la tipografía, los efectos o las retículas del estilo
	readonly value: unknown;
};

export const COMPONENT_TYPE = Object.freeze({
	set: "COMPONENT_SET",
	component: "COMPONENT",
} as const);
export type ComponentType =
	(typeof COMPONENT_TYPE)[keyof typeof COMPONENT_TYPE];

export type ComponentProperty = {
	readonly name: string;
	readonly type: string;
	// null en un SLOT: Figma no le da valor por defecto
	readonly defaultValue: string | boolean | null;
};

export type ComponentEntry = {
	readonly id: string;
	readonly key: string;
	readonly name: string;
	readonly type: ComponentType;
	readonly page: string;
	readonly pageIndex: number;
	readonly description: string;
	// Propiedad de variante → sus opciones (vacío en un componente suelto)
	readonly variants: Readonly<Record<string, readonly string[]>>;
	// Las propiedades que no son de variante
	readonly properties: readonly ComponentProperty[];
	// Variantes del set (0 en un componente suelto)
	readonly variantCount: number;
};

// Instancias de un frame de primer nivel, contadas por el nombre del set (si el principal es una variante) o del componente
export type FrameInstances = {
	readonly page: string;
	readonly frameId: string;
	readonly frameName: string;
	readonly counts: Readonly<Record<string, number>>;
};

export const EXPORT_FORMAT = Object.freeze({
	png: "PNG",
	jpg: "JPG",
	svg: "SVG",
	pdf: "PDF",
} as const);
export type ExportFormat = (typeof EXPORT_FORMAT)[keyof typeof EXPORT_FORMAT];

// Los bytes que devuelve Figma por nodo (aún sin guardar); ancho y alto solo cuando el formato los trae (PNG)
export type ExportedBytes = {
	readonly nodeId: string;
	readonly bytes: Uint8Array;
	readonly width?: number;
	readonly height?: number;
};

// Una entrada del índice de `figma_export`: dónde quedó cada nodo
export type ExportedNode = {
	readonly nodeId: string;
	readonly path: string;
	readonly bytes: number;
	readonly width?: number;
	readonly height?: number;
};

// Lo que deja una lectura: el JSON completo en disco y unos conteos pequeños para la conversación
export type ReadSummary = Readonly<
	Record<string, number | Readonly<Record<string, number>>>
>;
export type ReadFile = {
	readonly path: string;
	readonly bytes: number;
	readonly summary: ReadSummary;
};

// --- Resúmenes: lo pequeño que viaja en la respuesta (el JSON completo va a disco) ---

const countBy = <T>(
	items: readonly T[],
	key: (item: T) => string,
	amount: (item: T) => number,
): Record<string, number> => {
	const out: Record<string, number> = {};
	for (const item of items)
		out[key(item)] = (out[key(item)] ?? 0) + amount(item);
	return out;
};

export const variablesSummary = (read: VariablesRead): ReadSummary => ({
	collections: read.collections.length,
	variables: countBy(
		read.collections,
		(c) => c.name,
		(c) => c.variables.length,
	),
	modes: countBy(
		read.collections,
		(c) => c.name,
		(c) => c.modes.length,
	),
	...(read.bindings !== undefined && { bindings: read.bindings.length }),
});

export const stylesSummary = (styles: readonly StyleEntry[]): ReadSummary => {
	const counts: Record<string, number> = {};
	for (const kind of Object.values(STYLE_KIND)) counts[kind] = 0;
	for (const style of styles)
		counts[style.kind] = (counts[style.kind] ?? 0) + 1;
	return counts;
};

export const componentsSummary = (
	components: readonly ComponentEntry[],
): ReadSummary => ({
	sets: components.filter((c) => c.type === COMPONENT_TYPE.set).length,
	components: components.filter((c) => c.type === COMPONENT_TYPE.component)
		.length,
	pages: new Set(components.map((c) => c.pageIndex)).size,
});

export const instancesSummary = (
	frames: readonly FrameInstances[],
): ReadSummary => ({
	frames: frames.length,
	instances: frames.reduce(
		(sum, f) => sum + Object.values(f.counts).reduce((a, n) => a + n, 0),
		0,
	),
});

export const exportSummary = (nodes: readonly ExportedNode[]): ReadSummary => ({
	files: nodes.length,
	bytes: nodes.reduce((sum, n) => sum + n.bytes, 0),
});

// Cómo se llama cada lectura en el nombre de su fichero (reads/<lectura>_<fecha>_<hora>.json)
export const READ_KIND = Object.freeze({
	variables: "variables",
	styles: "styles",
	components: "components",
	instances: "instances",
	export: "export",
	designContext: "design-context",
} as const);
