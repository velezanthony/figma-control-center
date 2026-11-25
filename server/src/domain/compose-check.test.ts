import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	COMPOSE_CONTRACT,
	type ComposeBlock,
	type ComposeFile,
} from "./compose.ts";
import {
	type ComposeCatalog,
	composeCatalogIssues,
	composeOfflineIssues,
	composeSheetsUsed,
} from "./compose-check.ts";

const file = (root: ComposeBlock): ComposeFile => ({
	contract: COMPOSE_CONTRACT,
	key: "alta",
	title: "Alta",
	target: { page: "Pruebas", width: 640 },
	root,
});

const SHEETS = [
	{ key: "button", title: "Button" },
	{ key: "field-group", title: "Field group" },
];

const CATALOG: ComposeCatalog = {
	sets: [
		{
			name: "Button",
			variants: { tamano: ["sm", "md"], tipo: ["primary", "ghost"] },
			properties: [
				{ name: "Etiqueta#1:2", type: "TEXT" },
				{ name: "Mostrar icono#1:3", type: "BOOLEAN" },
				{ name: "Icono#1:4", type: "INSTANCE_SWAP" },
			],
		},
		{
			name: "Field group",
			variants: {},
			properties: [{ name: "ayuda#2:1", type: "SLOT" }],
		},
	],
	variables: [
		{ name: "spacing/4", collection: "Tokens", type: "FLOAT" },
		{ name: "radius/md", collection: "Tokens", type: "FLOAT" },
		{ name: "brand/500", collection: "Primitives", type: "COLOR" },
		{ name: "surface", collection: "Tokens", type: "COLOR" },
	],
	textStyles: ["Título/L", "Texto/S"],
};

const issues = (root: ComposeBlock) =>
	composeCatalogIssues(file(root), SHEETS, CATALOG);
const offline = (root: ComposeBlock) =>
	composeOfflineIssues(file(root), SHEETS);

describe("composeOfflineIssues: lo que no necesita Figma", () => {
	it("un compose limpio no da ningún problema", () => {
		assert.deepEqual(
			offline({
				stack: "VERTICAL",
				gap: "spacing/4",
				fill: "surface",
				children: [
					{ text: "Hola", style: "Título/L", color: "brand/500" },
					{ use: "button", variant: { tamano: "sm" } },
				],
			}),
			[],
		);
	});

	it("un color suelto en un relleno, un borde de texto o un número en un gap son valores crudos, con su puntero", () => {
		const found = offline({
			stack: "VERTICAL",
			gap: "16",
			fill: "#ff6600",
			children: [
				{ text: "x", style: "Texto/S", color: "rgb(1, 2, 3)" },
				{ stack: "HORIZONTAL", padding: ["8px", "spacing/4"], children: [] },
			],
		});
		assert.deepEqual(
			found.map((i) => i.pointer),
			[
				"/root/gap",
				"/root/fill",
				"/root/children/0/color",
				"/root/children/1/padding/0",
			],
		);
		assert.match(found[0]?.message ?? "", /valor suelto/);
		assert.match(found[0]?.message ?? "", /variable/);
	});

	it("una hoja que no está en sheets@1 se señala en `use`, también dentro de un slot", () => {
		const found = offline({
			stack: "VERTICAL",
			children: [
				{ use: "tarjeta" },
				{ use: "field-group", slots: { ayuda: [{ use: "badge" }] } },
			],
		});
		assert.deepEqual(
			found.map((i) => i.pointer),
			["/root/children/0/use", "/root/children/1/slots/ayuda/0/use"],
		);
		assert.match(found[0]?.message ?? "", /tarjeta/);
		assert.match(found[0]?.message ?? "", /button, field-group/);
	});

	it("una pieza de librería (`use.key`) queda fuera del MVP", () => {
		const found = offline({ use: { key: "k-externa" } });
		assert.deepEqual(
			found.map((i) => i.pointer),
			["/root/use"],
		);
		assert.match(found[0]?.message ?? "", /librería/);
	});

	it("`image`, `icon` y la rejilla GRID todavía no los pinta kit/compose@1", () => {
		const found = offline({
			stack: "GRID",
			children: [{ image: "a.png" }, { icon: "check" }],
		});
		assert.deepEqual(
			found.map((i) => i.pointer),
			["/root/stack", "/root/children/0/image", "/root/children/1/icon"],
		);
	});

	it("un padding con más de cuatro valores no tiene lados a los que ir", () => {
		const found = offline({
			stack: "VERTICAL",
			padding: ["a", "b", "c", "d", "e"],
			children: [],
		});
		assert.deepEqual(
			found.map((i) => i.pointer),
			["/root/padding"],
		);
	});
});

describe("composeCatalogIssues: contra el catálogo del archivo abierto", () => {
	it("un compose que cuadra con el catálogo no da ningún problema", () => {
		assert.deepEqual(
			issues({
				stack: "VERTICAL",
				gap: "spacing/4",
				padding: ["spacing/4", "Tokens/spacing/4"],
				radius: "radius/md",
				fill: "surface",
				children: [
					{ text: "Alta", style: "Título/L", color: "brand/500" },
					{
						use: "button",
						variant: { tamano: "md", tipo: "primary" },
						props: { Etiqueta: "Guardar", "Mostrar icono": false },
					},
					{ use: "field-group", slots: { ayuda: [] } },
				],
			}),
			[],
		);
	});

	it("una variable que no existe, o de otro tipo, se señala en su campo", () => {
		const found = issues({
			stack: "VERTICAL",
			gap: "spacing/9",
			fill: "spacing/4",
			radius: "brand/500",
			children: [],
		});
		assert.deepEqual(
			found.map((i) => i.pointer),
			["/root/gap", "/root/fill", "/root/radius"],
		);
		assert.match(found[0]?.message ?? "", /no existe/);
		assert.match(found[1]?.message ?? "", /FLOAT/);
		assert.match(found[1]?.message ?? "", /COLOR/);
		assert.match(found[2]?.message ?? "", /COLOR/);
	});

	it("un estilo de texto que no existe se señala en `style`", () => {
		const found = issues({ text: "x", style: "Nada" });
		assert.deepEqual(
			found.map((i) => i.pointer),
			["/root/style"],
		);
		assert.match(found[0]?.message ?? "", /estilo de texto/);
	});

	it("una hoja cuyo set no está en el archivo manda a pintar la hoja", () => {
		const found = composeCatalogIssues(file({ use: "button" }), SHEETS, {
			...CATALOG,
			sets: [],
		});
		assert.deepEqual(
			found.map((i) => i.pointer),
			["/root/use"],
		);
		assert.match(found[0]?.message ?? "", /kit\/build-component@1/);
	});

	it("dos sets con el título de la hoja es ambiguo", () => {
		const found = composeCatalogIssues(file({ use: "button" }), SHEETS, {
			...CATALOG,
			sets: [...CATALOG.sets, { name: "button", variants: {}, properties: [] }],
		});
		assert.match(found[0]?.message ?? "", /más de un set/);
	});

	it("una propiedad de variante o una opción que no existen dicen las válidas", () => {
		const found = issues({
			stack: "VERTICAL",
			children: [
				{ use: "button", variant: { tamano: "xl" } },
				{ use: "button", variant: { color: "rojo" } },
			],
		});
		assert.deepEqual(
			found.map((i) => i.pointer),
			["/root/children/0/variant/tamano", "/root/children/1/variant/color"],
		);
		assert.match(found[0]?.message ?? "", /sm, md/);
		assert.match(found[1]?.message ?? "", /tamano, tipo/);
	});

	it("una prop inexistente, de tipo que no casa o sin soporte se señala por su nombre", () => {
		const found = issues({
			stack: "VERTICAL",
			children: [
				{
					use: "button",
					props: {
						Nada: "x",
						Etiqueta: true,
						"Mostrar icono": "sí",
						Icono: "check",
					},
				},
			],
		});
		assert.deepEqual(
			found.map((i) => i.pointer),
			[
				"/root/children/0/props/Nada",
				"/root/children/0/props/Etiqueta",
				"/root/children/0/props/Mostrar icono",
				"/root/children/0/props/Icono",
			],
		);
	});

	it("un slot que el set no tiene se señala, y su contenido se valida igual", () => {
		const found = issues({
			stack: "VERTICAL",
			children: [
				{
					use: "field-group",
					slots: {
						ayuda: [{ text: "x", style: "Nada" }],
						pie: [],
					},
				},
			],
		});
		assert.deepEqual(
			found.map((i) => i.pointer),
			["/root/children/0/slots/pie", "/root/children/0/slots/ayuda/0/style"],
		);
	});

	it("una variante pedida a un set sin propiedades de variante se señala", () => {
		const found = issues({ use: "field-group", variant: { tamano: "sm" } });
		assert.deepEqual(
			found.map((i) => i.pointer),
			["/root/variant/tamano"],
		);
	});
});

describe("composeSheetsUsed", () => {
	it("lista cada hoja una sola vez, también las de los slots, en el orden en que salen", () => {
		assert.deepEqual(
			composeSheetsUsed(
				file({
					stack: "VERTICAL",
					children: [
						{ use: "field-group", slots: { ayuda: [{ use: "button" }] } },
						{ use: "button" },
						{ use: { key: "externa" } },
					],
				}),
			),
			["field-group", "button"],
		);
	});
});
