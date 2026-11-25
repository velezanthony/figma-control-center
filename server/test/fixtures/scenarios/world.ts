// El archivo de Figma «de mentira» que ve el simulador: una página con dos marcos, un texto y un icono, y el catálogo
// (variables, estilos, componentes e instancias) que leen las herramientas de M3.
// Se construye con los constructores del contrato (tipos de @figma/plugin-typings, ids válidos).
import {
	type ComponentsValue,
	type DesignReadValue,
	designReadValue,
	componentsValue,
	type InstancesValue,
	instancesValue,
	type MetadataNode,
	metadataValue,
	type StylesValue,
	stylesValue,
	type VariablesValue,
	variablesValue,
} from "../../contracts/figma-values.ts";

type Binding = NonNullable<VariablesValue["bindings"]>[number];

// Lo que el script de figma_design_context leería de un nodo: el contexto y, si es un set, sus propiedades de variante
// (con ellas el simulador distingue una `variant` que no existe)
export type DesignContextEntry = {
	readonly read: DesignReadValue;
	readonly variants?: Readonly<Record<string, readonly string[]>>;
};

export type Catalog = {
	// Páginas del archivo, por orden (las que existen para `page`/`pages`)
	readonly pages: readonly string[];
	readonly variables: VariablesValue;
	// Variables ligadas en el subárbol de cada nodo (lo que devuelve figma_variables con ese nodeId)
	readonly bindings: ReadonlyMap<string, readonly Binding[]>;
	readonly styles: StylesValue["styles"];
	readonly components: ComponentsValue["components"];
	readonly frames: InstancesValue["frames"];
	// El contexto de diseño de los nodos que figma_design_context puede leer, por id
	readonly designContexts: ReadonlyMap<string, DesignContextEntry>;
};

export type World = {
	readonly file: string;
	readonly page: string;
	readonly root: MetadataNode;
	// Tamaño en px de lo exportable
	readonly sizes: ReadonlyMap<string, { readonly width: number; readonly height: number }>;
	readonly catalog: Catalog;
};

const TOKENS_BG = "VariableID:1:2";
const GRAY_900 = "VariableID:1:3";

const variables = variablesValue({
	collections: [
		{
			id: "VariableCollectionId:1:1",
			name: "Primitives",
			modes: [{ id: "1:0", name: "Valor" }],
			defaultModeId: "1:0",
			variables: [
				{
					id: GRAY_900,
					name: "gris/900",
					resolvedType: "COLOR",
					scopes: ["ALL_SCOPES"],
					description: "",
					valuesByMode: { "1:0": { r: 0.1, g: 0.1, b: 0.1, a: 1 } },
				},
			],
		},
		{
			id: "VariableCollectionId:2:1",
			name: "Tokens",
			modes: [
				{ id: "2:0", name: "Claro" },
				{ id: "2:1", name: "Oscuro" },
			],
			defaultModeId: "2:0",
			variables: [
				{
					id: TOKENS_BG,
					name: "color/fondo",
					resolvedType: "COLOR",
					scopes: ["FRAME_FILL", "SHAPE_FILL"],
					description: "Fondo de las tarjetas",
					valuesByMode: {
						"2:0": { r: 1, g: 1, b: 1, a: 1 },
						"2:1": { alias: { id: GRAY_900, name: "gris/900" } },
					},
				},
				{
					id: "VariableID:2:3",
					name: "espacio/m",
					resolvedType: "FLOAT",
					scopes: ["GAP"],
					description: "",
					valuesByMode: { "2:0": 16, "2:1": 16 },
				},
			],
		},
	],
});

const styles = stylesValue({
	styles: [
		{
			id: "S:marca,",
			key: "marca",
			name: "Marca/Primario",
			kind: "paint",
			description: "",
			boundVariables: {},
			value: [{ type: "SOLID", color: { r: 1, g: 0.4, b: 0 }, opacity: 1 }],
		},
		{
			id: "S:titulo,",
			key: "titulo",
			name: "Título/L",
			kind: "text",
			description: "Cabecera de página",
			boundVariables: {},
			value: {
				fontName: { family: "Montserrat", style: "Bold" },
				fontSize: 24,
			},
		},
	],
}).styles;

const components = componentsValue({
	components: [
		{
			id: "20:1",
			key: "k-boton",
			name: "Botón",
			type: "COMPONENT_SET",
			page: "Componentes",
			pageIndex: 1,
			description: "Acción principal",
			variants: { Tamaño: ["S", "M"], Tipo: ["Primario", "Secundario"] },
			properties: [{ name: "Texto#1:0", type: "TEXT", defaultValue: "Aceptar" }],
			variantCount: 4,
		},
		{
			id: "21:1",
			key: "k-icono",
			name: "Icono",
			type: "COMPONENT",
			page: "Componentes",
			pageIndex: 1,
			description: "",
			variants: {},
			properties: [],
			variantCount: 0,
		},
	],
}).components;

const frames = instancesValue({
	frames: [
		{
			page: "Inicio",
			frameId: "10:1",
			frameName: "Tarjeta",
			counts: { Botón: 2, Icono: 1 },
		},
	],
}).frames;

const BOX = { x: 0, y: 0, w: 120, h: 80 };
const markInstance = (key: string, name: string) => ({
	id: `10:${key}`,
	parent: "10:1",
	name,
	type: "INSTANCE",
	visible: true,
	box: BOX,
	instance: { component: `k-${name.toLowerCase()}`, variant: {}, props: {}, overridden: [] },
});
const componentOf = (name: string, extra: object = {}) => ({
	name,
	kind: "COMPONENT_SET" as const,
	key: `k-${name.toLowerCase()}`,
	remote: false,
	variants: {},
	properties: [],
	...extra,
});

const designContexts: ReadonlyMap<string, DesignContextEntry> = new Map([
	[
		// Un frame de área con una marca (hoja por clave), un aviso sin hoja, un texto suelto y un relleno suelto
		"10:1",
		{
			read: designReadValue({
				fileName: "Archivo de ejemplo",
				root: "10:1",
				origin: { kind: "area", key: "inicio/portada" },
				nodes: [
					{
						id: "10:1",
						parent: null,
						name: "Tarjeta",
						type: "FRAME",
						visible: true,
						box: BOX,
						fills: [{ variable: "VariableID:1:9" }],
					},
					markInstance("6", "Marca"),
					markInstance("7", "Aviso"),
					{
						id: "10:8",
						parent: "10:1",
						name: "Título",
						type: "TEXT",
						visible: true,
						box: BOX,
						text: {
							characters: "Hola",
							font: {
								family: "Inter",
								style: "Bold",
								size: 20,
								lineHeight: { unit: "AUTO" },
								letterSpacing: { unit: "PERCENT", value: 0 },
							},
						},
					},
					{
						id: "10:9",
						parent: "10:1",
						name: "Fondo suelto",
						type: "RECTANGLE",
						visible: true,
						box: BOX,
						fills: [{ raw: { type: "SOLID", color: { r: 1, g: 0, b: 0 } } }],
					},
				],
				variables: {
					"VariableID:1:9": {
						name: "fondo",
						collection: "Base",
						type: "COLOR",
						value: { r: 1, g: 1, b: 1, a: 1 },
					},
				},
				styles: {},
				components: {
					"k-marca": componentOf("Marca", { sheet: "marca" }),
					"k-aviso": componentOf("Aviso"),
				},
			}),
		},
	],
	[
		// Un frame con una marca cuyo set no lleva la clave de la hoja: se encuentra por el nombre del set (R-1)
		"10:5",
		{
			read: designReadValue({
				fileName: "Archivo de ejemplo",
				root: "10:5",
				nodes: [
					{
						id: "10:5",
						parent: null,
						name: "Sin clave",
						type: "FRAME",
						visible: true,
						box: BOX,
					},
					{ ...markInstance("6", "Marca"), id: "10:6", parent: "10:5" },
				],
				variables: {},
				styles: {},
				components: { "k-marca": componentOf("Marca") },
			}),
		},
	],
	[
		// Un set como raíz: solo su variante por defecto, el resto como tabla (R-3)
		"20:1",
		{
			variants: { Tamaño: ["S", "M"], Tipo: ["Primario", "Secundario"] },
			read: designReadValue({
				fileName: "Archivo de ejemplo",
				root: "20:1",
				origin: { kind: "sheet", key: "marca" },
				nodes: [
					{
						id: "20:1",
						parent: null,
						name: "Botón",
						type: "COMPONENT_SET",
						visible: true,
						box: BOX,
					},
					{
						id: "20:2",
						parent: "20:1",
						name: "Tamaño=S, Tipo=Primario",
						type: "COMPONENT",
						visible: true,
						box: BOX,
					},
				],
				variables: {},
				styles: {},
				components: {
					"k-boton": componentOf("Botón", {
						variants: { Tamaño: ["S", "M"], Tipo: ["Primario", "Secundario"] },
					}),
				},
			}),
		},
	],
]);

export const DEFAULT_WORLD: World = {
	file: "Archivo de ejemplo",
	page: "Inicio",
	root: metadataValue({
		id: "0:1",
		name: "Inicio",
		type: "PAGE",
		children: [
			{
				id: "10:1",
				name: "Tarjeta",
				type: "FRAME",
				children: [{ id: "10:2", name: "Título", type: "TEXT" }],
			},
			{ id: "10:3", name: "Botón", type: "COMPONENT" },
			{ id: "10:4", name: "Icono", type: "INSTANCE" },
		],
	}),
	sizes: new Map([
		["10:1", { width: 120, height: 80 }],
		["10:3", { width: 64, height: 32 }],
		["10:4", { width: 24, height: 24 }],
		["10:5", { width: 120, height: 80 }],
		["20:1", { width: 200, height: 100 }],
	]),
	catalog: {
		pages: ["Inicio", "Componentes"],
		variables,
		bindings: new Map([
			["10:1", [{ nodeId: "10:1", field: "fills", variableId: TOKENS_BG }]],
		]),
		styles,
		components,
		frames,
		designContexts,
	},
};
