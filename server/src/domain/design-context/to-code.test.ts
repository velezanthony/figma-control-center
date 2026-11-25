import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	DesignComponent,
	DesignNode,
	DesignRead,
	DesignValue,
	DesignVariable,
} from "../design-context.ts";
import type { MapTokens } from "../map.ts";
import { type SheetRef, type ToCodeInput, toCode } from "./to-code.ts";

const TOKENS: MapTokens = {
	collections: ["Tokens", "Base"],
	classPrefixes: { fill: ["bg-"], text: ["text-"], stroke: ["border-"] },
	classToVariable: [
		{ from: "^text-(.+)$", to: "text/$1" },
		{ from: "^(.+)$", to: "$1" },
		{ from: "^([a-z]+)-(\\d+)$", to: "$1/$2" },
	],
	numbers: { radius: { prefix: "radius/" }, spacing: { prefix: "spacing/" } },
};

const px = (value: number): DesignValue => ({ raw: value });

const node = (over: Partial<DesignNode> & { id: string }): DesignNode => ({
	parent: null,
	name: over.id,
	type: "FRAME",
	visible: true,
	box: { x: 0, y: 0, w: 10, h: 10 },
	...over,
});

const component = (over: Partial<DesignComponent> = {}): DesignComponent => ({
	name: "Botón",
	kind: "COMPONENT_SET",
	key: "k-boton",
	remote: false,
	variants: {},
	properties: [],
	...over,
});

const variable = (over: Partial<DesignVariable> = {}): DesignVariable => ({
	name: "brand/500",
	collection: "Tokens",
	type: "COLOR",
	value: { r: 1, g: 0, b: 0, a: 1 },
	...over,
});

const read = (over: Partial<DesignRead> = {}): DesignRead => ({
	fileName: "Archivo",
	root: "1:1",
	nodes: [],
	variables: {},
	styles: {},
	components: {},
	...over,
});

const input = (over: Partial<ToCodeInput> = {}): ToCodeInput => ({
	read: read(),
	sheets: [],
	tokens: TOKENS,
	fingerprintTitles: {},
	matches: [],
	...over,
});

const BUTTON: SheetRef = {
	key: "button",
	title: "Botón",
	source: "src/components/button.html",
	tag: "<ui-button>",
};

describe("toCode: la hoja de un componente", () => {
	it("el set con `fcc:sheet:<clave>` sale con la plantilla y la etiqueta de su hoja, by `key`", () => {
		const out = toCode(
			input({
				read: read({
					components: { "k-boton": component({ sheet: "button" }) },
				}),
				sheets: [BUTTON],
			}),
		);
		assert.deepEqual(out.components["k-boton"]?.code, {
			source: "src/components/button.html",
			tag: "<ui-button>",
			by: "key",
		});
		assert.equal(out.components["k-boton"]?.sheet, "button");
		assert.deepEqual(out.warnings, []);
	});

	it("sin clave, la hoja con el mismo título (sin mayúsculas ni espacios) sale con by `name`", () => {
		const out = toCode(
			input({
				read: read({
					components: {
						"k-fg": component({ key: "k-fg", name: "Field   GROUP" }),
					},
				}),
				sheets: [
					{ key: "field-group", title: "field group", source: "fg.html" },
				],
			}),
		);
		assert.deepEqual(out.components["k-fg"]?.code, {
			source: "fg.html",
			by: "name",
		});
		assert.equal(out.components["k-fg"]?.sheet, "field-group");
	});

	it("una clave `fcc:sheet:` que ya no está en sheets@1 cae al nombre del set", () => {
		const out = toCode(
			input({
				read: read({
					components: { "k-boton": component({ sheet: "borrada" }) },
				}),
				sheets: [BUTTON],
			}),
		);
		assert.equal(out.components["k-boton"]?.code?.by, "name");
		assert.equal(out.components["k-boton"]?.sheet, "button");
	});

	it("varias hojas con el mismo título: sin código, sus claves como candidatas y NO_CODE_MAPPING", () => {
		const out = toCode(
			input({
				read: read({ components: { "k-boton": component() } }),
				sheets: [
					BUTTON,
					{ key: "button-alt", title: "botón", source: "alt.html" },
				],
			}),
		);
		const c = out.components["k-boton"];
		assert.equal(c?.code, undefined);
		assert.equal(c?.sheet, undefined);
		assert.deepEqual(c?.candidates, ["button", "button-alt"]);
		assert.equal(out.warnings.length, 1);
		assert.equal(out.warnings[0]?.code, "NO_CODE_MAPPING");
		assert.equal(out.warnings[0]?.component, "k-boton");
		assert.match(out.warnings[0]?.message ?? "", /varias hojas/);
	});

	it("un set sin hoja da NO_CODE_MAPPING; si una huella de map@1 tiene su título, sale como candidata (no como mapeo)", () => {
		const bare = toCode(
			input({ read: read({ components: { "k-boton": component() } }) }),
		);
		assert.equal(bare.components["k-boton"]?.code, undefined);
		assert.equal(bare.components["k-boton"]?.candidates, undefined);
		assert.equal(bare.warnings[0]?.code, "NO_CODE_MAPPING");

		const hinted = toCode(
			input({
				read: read({ components: { "k-boton": component() } }),
				fingerprintTitles: { boton: "BOTÓN", otro: "Otro" },
			}),
		);
		assert.equal(hinted.components["k-boton"]?.code, undefined);
		assert.deepEqual(hinted.components["k-boton"]?.candidates, ["boton"]);
		assert.equal(hinted.warnings.length, 1);
	});

	it("una hoja sin `source` queda enlazada pero sin código, y avisa", () => {
		const out = toCode(
			input({
				read: read({
					components: { "k-boton": component({ sheet: "button" }) },
				}),
				sheets: [{ key: "button", title: "Botón" }],
			}),
		);
		const c = out.components["k-boton"];
		assert.equal(c?.sheet, "button");
		assert.equal(c?.code, undefined);
		assert.match(out.warnings[0]?.message ?? "", /source/);
	});

	it("`tag` solo sale si la hoja lo declara", () => {
		const out = toCode(
			input({
				read: read({ components: { "k-boton": component() } }),
				sheets: [{ key: "button", title: "Botón", source: "b.html" }],
			}),
		);
		assert.deepEqual(Object.keys(out.components["k-boton"]?.code ?? {}), [
			"source",
			"by",
		]);
	});
});

describe("toCode: las clases de lo que no es una instancia", () => {
	const withFill = (
		type: string,
		fills: DesignValue[],
		extra: Partial<DesignNode> = {},
	) =>
		input({
			read: read({
				variables: {
					v1: variable(),
					v2: variable({ name: "text/primary" }),
					v3: variable({ name: "brand/500", collection: "Otra" }),
				},
				nodes: [node({ id: "1:1", type, fills, ...extra })],
			}),
		});

	it("la variable de un relleno de marco da la clase `bg-` si map@1 sabe escribirla", () => {
		const out = toCode(withFill("FRAME", [{ variable: "v1" }]));
		assert.deepEqual(out.nodes[0]?.hints, {
			classes: ["bg-brand-500"],
			unmapped: [],
		});
		assert.equal(out.variables["v1"]?.codeClass, "brand-500");
	});

	it("el color de un texto usa el prefijo `text-` y el de un borde el `border-`", () => {
		const text = toCode(withFill("TEXT", [{ variable: "v2" }]));
		assert.deepEqual(text.nodes[0]?.hints?.classes, ["text-text-primary"]);
		const stroke = toCode(
			withFill("FRAME", [], { strokes: [{ variable: "v1" }] }),
		);
		assert.deepEqual(stroke.nodes[0]?.hints?.classes, ["border-brand-500"]);
	});

	it("una variable de una colección que map@1 no usa no da clase", () => {
		const out = toCode(withFill("FRAME", [{ variable: "v3" }]));
		assert.equal(out.variables["v3"]?.codeClass, undefined);
		assert.equal(out.nodes[0]?.hints, undefined);
	});

	it("un estilo no da clase y no es un valor suelto", () => {
		const out = toCode(withFill("FRAME", [{ style: "S:x" }]));
		assert.equal(out.nodes[0]?.hints, undefined);
	});

	it("sin map@1 no hay clases pero lo suelto sigue saliendo en `unmapped`", () => {
		const out = toCode({
			...withFill("FRAME", [{ variable: "v1" }, px(3)]),
			tokens: null,
		});
		assert.deepEqual(out.nodes[0]?.hints, { classes: [], unmapped: ["fills"] });
		assert.equal(out.variables["v1"]?.codeClass, undefined);
	});

	it("una clase que map@1 no devuelve a la misma variable no se sugiere", () => {
		const out = toCode(
			input({
				tokens: { ...TOKENS, classToVariable: [{ from: "^x$", to: "y" }] },
				read: read({
					variables: { v1: variable() },
					nodes: [node({ id: "1:1", fills: [{ variable: "v1" }] })],
				}),
			}),
		);
		assert.equal(out.variables["v1"]?.codeClass, undefined);
	});

	it("un relleno suelto sale en `unmapped` aunque map@1 tenga `numbers`", () => {
		const out = toCode(withFill("FRAME", [{ raw: { type: "SOLID" } }]));
		assert.deepEqual(out.nodes[0]?.hints, { classes: [], unmapped: ["fills"] });
	});

	it("un número suelto (radio, hueco, relleno interno) sale en `unmapped`, con y sin `tokens.numbers`; el cero no", () => {
		const layout = {
			mode: "VERTICAL" as const,
			wrap: false,
			gap: px(8),
			padding: [px(0), px(4), px(0), px(0)] as const,
			primaryAlign: "MIN",
			counterAlign: "MIN",
		};
		const radius = {
			tl: px(4),
			tr: { variable: "v1" },
			br: px(0),
			bl: px(0),
		};
		for (const tokens of [TOKENS, { ...TOKENS, numbers: undefined }]) {
			const out = toCode(
				input({
					tokens,
					read: read({
						variables: { v1: variable({ name: "radius/md", type: "FLOAT" }) },
						nodes: [node({ id: "1:1", layout, radius })],
					}),
				}),
			);
			assert.deepEqual(out.nodes[0]?.hints?.unmapped, [
				"gap",
				"padding",
				"radius",
			]);
		}
		const zero = toCode(
			input({
				read: read({
					nodes: [
						node({
							id: "1:1",
							layout: {
								...layout,
								gap: px(0),
								padding: [px(0), px(0), px(0), px(0)],
							},
							radius: { tl: px(0), tr: px(0), br: px(0), bl: px(0) },
						}),
					],
				}),
			}),
		);
		assert.equal(zero.nodes[0]?.hints, undefined);
	});

	it("los números ligados a una variable no son sueltos", () => {
		const out = toCode(
			input({
				read: read({
					variables: { v1: variable({ name: "spacing/4", type: "FLOAT" }) },
					nodes: [
						node({
							id: "1:1",
							layout: {
								mode: "HORIZONTAL",
								wrap: false,
								gap: { variable: "v1" },
								padding: [
									{ variable: "v1" },
									{ variable: "v1" },
									{ variable: "v1" },
									{ variable: "v1" },
								],
								primaryAlign: "MIN",
								counterAlign: "MIN",
							},
						}),
					],
				}),
			}),
		);
		assert.equal(out.nodes[0]?.hints, undefined);
	});

	it("un texto sin estilo de texto deja la fuente suelta en `unmapped`; con estilo, no", () => {
		const font = {
			family: "Inter",
			style: "Bold",
			size: 12,
			lineHeight: { unit: "AUTO" },
			letterSpacing: { unit: "PERCENT", value: 0 },
		};
		const loose = toCode(
			input({
				read: read({
					nodes: [
						node({ id: "1:1", type: "TEXT", text: { characters: "a", font } }),
					],
				}),
			}),
		);
		assert.deepEqual(loose.nodes[0]?.hints?.unmapped, ["text.font"]);
		const styled = toCode(
			input({
				read: read({
					nodes: [
						node({
							id: "1:1",
							type: "TEXT",
							text: { characters: "a", font, style: "S:t" },
						}),
					],
				}),
			}),
		);
		assert.equal(styled.nodes[0]?.hints, undefined);
	});

	it("una instancia no lleva `hints`: su componente ya es el mapeo", () => {
		const out = toCode(
			input({
				read: read({
					nodes: [
						node({
							id: "1:1",
							type: "INSTANCE",
							fills: [px(1)],
							instance: {
								component: "k",
								variant: {},
								props: {},
								overridden: [],
							},
						}),
					],
				}),
			}),
		);
		assert.equal(out.nodes[0]?.hints, undefined);
	});
});

describe("toCode: el rastro del último build-screen", () => {
	it("`matched.by` sale en la instancia que `report.matches` nombra, y solo ahí", () => {
		const instance = {
			component: "k",
			variant: {},
			props: {},
			overridden: [],
		};
		const out = toCode(
			input({
				read: read({
					nodes: [
						node({ id: "1:1", type: "INSTANCE", instance }),
						node({ id: "1:2", type: "INSTANCE", instance }),
						node({ id: "1:3" }),
					],
				}),
				matches: [
					{ node: "1:1", set: "Boton", by: "rule:boton" },
					{ node: "1:3", set: "Otro", by: "rule:otro" },
				],
			}),
		);
		assert.deepEqual(out.nodes[0]?.matched, { by: "rule:boton" });
		assert.equal(out.nodes[1]?.matched, undefined);
		assert.equal(out.nodes[2]?.matched, undefined);
	});
});

describe("toCode: no cambia lo que no le toca", () => {
	it("deja igual lo que lee la pestaña (ids, cajas, variables, estilos y origen)", () => {
		const origin = { kind: "area" as const, key: "a/b" };
		const r = read({
			origin,
			nodes: [node({ id: "1:1", name: "Hola" })],
			variables: { v1: variable() },
			styles: { s1: { name: "T", kind: "text", key: "k", value: {} } },
		});
		const out = toCode(input({ read: r }));
		assert.equal(out.nodes[0]?.name, "Hola");
		assert.deepEqual(out.nodes[0]?.box, { x: 0, y: 0, w: 10, h: 10 });
		assert.equal(out.variables["v1"]?.name, "brand/500");
	});
});
