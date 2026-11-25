// El script interno de figma_design_context contra el doble del API de plugins. Lo que prueba:
// el recorrido en anchura con tope, lo que se lee de cada nodo (auto-layout, variables resueltas, estilos, texto), no
// bajar dentro de instancias salvo en sus huecos, la clave `fcc:` de origen y el set como raíz (R-2, R-3). El mapeo a
// código es del servidor (domain/design-context/to-code.test.ts); la prueba con Figma real, de make kit-contract.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { DESIGN_CONTEXT_SCRIPT } from "#adapters/cdp/scripts/design-context.ts";
import type { DesignRead } from "#domain/design-context.ts";
import {
	type FakeFigma,
	type FakeNode,
	installFakeFigma,
} from "../fake-figma.ts";

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
	...args: string[]
) => (params: unknown) => Promise<unknown>;

type Unknown = { unknownVariant: { variants: Record<string, string[]> } };
type Params = {
	nodeId: string;
	maxNodes?: number;
	variant?: Record<string, string> | null;
};

let fake: FakeFigma;
beforeEach(() => {
	fake = installFakeFigma();
});

const run = async (p: Params): Promise<DesignRead> =>
	(await new AsyncFunction("params", DESIGN_CONTEXT_SCRIPT)({
		maxNodes: 400,
		variant: null,
		...p,
	})) as DesignRead;

const runRaw = async (p: Params): Promise<DesignRead & Partial<Unknown>> =>
	(await run(p)) as DesignRead & Partial<Unknown>;

const frame = (parent: FakeNode, name: string): FakeNode => {
	const f = fake.node(parent, "FRAME", name);
	f.resize(200, 100);
	return f;
};

const byName = (read: DesignRead, name: string) => {
	const n = read.nodes.find((x) => x.name === name);
	assert.ok(n, `no hay un nodo «${name}»`);
	return n;
};

describe("design-context: el recorrido", () => {
	it("recorre en anchura, el padre antes que sus hijos, con la raíz sin padre y la caja relativa a su padre", async () => {
		const root = frame(fake.currentPage, "Raíz");
		const a = frame(root, "A");
		const b = frame(root, "B");
		const a1 = frame(a, "A1");
		a.x = 10;
		a.y = 20;
		const read = await run({ nodeId: root.id });
		assert.equal(read.root, root.id);
		assert.deepEqual(
			read.nodes.map((n) => n.name),
			["Raíz", "A", "B", "A1"],
		);
		assert.equal(read.nodes[0]?.parent, null);
		assert.equal(byName(read, "A").parent, root.id);
		assert.equal(byName(read, "A1").parent, a.id);
		assert.deepEqual(byName(read, "A").box, { x: 10, y: 20, w: 200, h: 100 });
		assert.equal(b.id !== a1.id, true);
		assert.equal(read.fileName, "Archivo");
		assert.equal(read.truncated, undefined);
	});

	it("con `maxNodes` corta y deja en `truncated.children` los ids que faltan", async () => {
		const root = frame(fake.currentPage, "Raíz");
		const a = frame(root, "A");
		const b = frame(root, "B");
		const a1 = frame(a, "A1");
		const read = await run({ nodeId: root.id, maxNodes: 2 });
		assert.deepEqual(
			read.nodes.map((n) => n.name),
			["Raíz", "A"],
		);
		assert.deepEqual(read.truncated, {
			reason: "max-nodes",
			children: [b.id, a1.id],
		});
	});

	it("un nodo que no existe es NodeNotFound (marca de los scripts de lectura)", async () => {
		await assert.rejects(run({ nodeId: "999:999" }), /node_not_found/);
	});

	it("un nodo oculto sale con `visible: false`", async () => {
		const root = frame(fake.currentPage, "Raíz");
		frame(root, "Oculto").visible = false;
		const read = await run({ nodeId: root.id });
		assert.equal(byName(read, "Oculto").visible, false);
	});
});

describe("design-context: lo que se lee de un nodo", () => {
	it("auto-layout: modo, hueco y relleno interno con su variable o suelto, alineación y ajuste de tamaño", async () => {
		const tokens = fake.collection("Tokens", 1, { "spacing/4": 16 });
		const space = [...fake.variableList.values()][0];
		assert.ok(space);
		const root = frame(fake.currentPage, "Raíz");
		root.layoutMode = "VERTICAL";
		root.setBoundVariable("itemSpacing", space);
		root.paddingTop = 8;
		root.paddingLeft = 12;
		root.primaryAxisAlignItems = "CENTER";
		root.counterAxisAlignItems = "MAX";
		const child = frame(root, "Hijo");
		child.layoutSizingHorizontal = "FILL";
		child.layoutSizingVertical = "HUG";
		const read = await run({ nodeId: root.id });
		const layout = byName(read, "Raíz").layout;
		assert.equal(layout?.mode, "VERTICAL");
		assert.equal(layout?.wrap, false);
		assert.deepEqual(layout?.gap, { variable: space.id });
		assert.deepEqual(layout?.padding, [
			{ raw: 8 },
			{ raw: 0 },
			{ raw: 0 },
			{ raw: 12 },
		]);
		assert.equal(layout?.primaryAlign, "CENTER");
		assert.equal(layout?.counterAlign, "MAX");
		assert.deepEqual(byName(read, "Hijo").placement?.sizing, {
			h: "FILL",
			v: "HUG",
		});
		assert.equal(byName(read, "Hijo").layout, undefined);
		assert.equal(read.variables[space.id]?.collection, tokens.name);
		assert.deepEqual(read.variables[space.id], {
			name: "spacing/4",
			collection: "Tokens",
			type: "FLOAT",
			value: 16,
		});
	});

	it("el hueco entre filas (`counterGap`) solo sale con wrap: sin él Figma da 0 y no es un dato", async () => {
		const flat = frame(fake.currentPage, "Plano");
		flat.layoutMode = "HORIZONTAL";
		const wrapped = frame(fake.currentPage, "Envuelto");
		wrapped.layoutMode = "HORIZONTAL";
		wrapped.layoutWrap = "WRAP";
		wrapped.counterAxisSpacing = 6;
		assert.equal(
			(await run({ nodeId: flat.id })).nodes[0]?.layout?.counterGap,
			undefined,
		);
		const w = (await run({ nodeId: wrapped.id })).nodes[0]?.layout;
		assert.equal(w?.wrap, true);
		assert.deepEqual(w?.counterGap, { raw: 6 });
	});

	it("un marco sin auto-layout ni padre con auto-layout no lleva `layout` ni `placement`", async () => {
		const root = frame(fake.currentPage, "Raíz");
		const read = await run({ nodeId: root.id });
		assert.equal(read.nodes[0]?.layout, undefined);
		assert.equal(read.nodes[0]?.placement, undefined);
	});

	it("un relleno ligado a una variable de color sale con la variable resuelta en el modo por defecto; un alias se sigue hasta el valor", async () => {
		fake.collection("Base", 1, { "gris/900": { r: 0.1, g: 0.1, b: 0.1 } });
		const base = [...fake.variableList.values()][0];
		fake.collection("Tokens", 2, { "color/fondo": { r: 1, g: 1, b: 1 } });
		const alias = [...fake.variableList.values()][1];
		assert.ok(base && alias);
		const mode = fake.collections[1]?.defaultModeId ?? "";
		alias.valuesByMode[mode] = { type: "VARIABLE_ALIAS", id: base.id };
		const root = frame(fake.currentPage, "Raíz");
		root.fills = [
			fake.variables.setBoundVariableForPaint(
				{ type: "SOLID", color: { r: 0, g: 0, b: 0 } },
				"color",
				alias,
			),
		];
		const read = await run({ nodeId: root.id });
		assert.deepEqual(read.nodes[0]?.fills, [{ variable: alias.id }]);
		assert.deepEqual(read.variables[alias.id], {
			name: "color/fondo",
			collection: "Tokens",
			type: "COLOR",
			value: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
			aliasOf: ["gris/900"],
		});
	});

	it("un relleno sin variable sale como valor suelto y los rellenos ocultos no cuentan", async () => {
		const root = frame(fake.currentPage, "Raíz");
		root.fills = [
			{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 1 },
			{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, visible: false },
		];
		const read = await run({ nodeId: root.id });
		assert.deepEqual(read.nodes[0]?.fills, [
			{ raw: { type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 1 } },
		]);
	});

	it("un estilo de relleno o de efecto sale por su id, con su nombre y su valor en `styles`", async () => {
		const paint = fake.paintStyle("Marca/Primario", [
			{ type: "SOLID", color: { r: 1, g: 0.4, b: 0 } },
		]);
		const shadow = fake.effectStyle("shadow-sm");
		const root = frame(fake.currentPage, "Raíz");
		root.fillStyleId = paint.id;
		await root.setEffectStyleIdAsync(shadow.id);
		const read = await run({ nodeId: root.id });
		assert.deepEqual(read.nodes[0]?.fills, [{ style: paint.id }]);
		assert.deepEqual(read.nodes[0]?.effects, [{ style: shadow.id }]);
		assert.equal(read.styles[paint.id]?.kind, "paint");
		assert.equal(read.styles[paint.id]?.name, "Marca/Primario");
		assert.equal(read.styles[shadow.id]?.kind, "effect");
	});

	it("los radios salen por esquina (con su variable o sueltos) y solo si alguno no es cero", async () => {
		fake.collection("Tokens", 1, { "radius/md": 8 });
		const radius = [...fake.variableList.values()][0];
		assert.ok(radius);
		const round = frame(fake.currentPage, "Redondo");
		round.setBoundVariable("topLeftRadius", radius);
		const loose = frame(fake.currentPage, "Suelto");
		loose.cornerRadius = 4;
		const flat = frame(fake.currentPage, "Plano");
		const a = await run({ nodeId: round.id });
		assert.deepEqual(a.nodes[0]?.radius, {
			tl: { variable: radius.id },
			tr: { raw: 0 },
			br: { raw: 0 },
			bl: { raw: 0 },
		});
		const b = await run({ nodeId: loose.id });
		assert.deepEqual(b.nodes[0]?.radius?.tl, { raw: 4 });
		const c = await run({ nodeId: flat.id });
		assert.equal(c.nodes[0]?.radius, undefined);
	});

	it("el texto trae sus caracteres, su fuente y su estilo de texto", async () => {
		const style = fake.textStyle("Inter", "Bold", 20, { lineHeight: 28 });
		const root = frame(fake.currentPage, "Raíz");
		const t = fake.text(root, "Título", "Hola");
		await fake.loadFontAsync({ family: "Inter", style: "Bold" });
		await t.setTextStyleIdAsync(style.id);
		const read = await run({ nodeId: root.id });
		const text = byName(read, "Título").text;
		assert.equal(text?.characters, "Hola");
		assert.deepEqual(text?.font, {
			family: "Inter",
			style: "Bold",
			size: 20,
			lineHeight: { unit: "PIXELS", value: 28 },
			letterSpacing: { unit: "PIXELS", value: 0 },
		});
		assert.equal(text?.style, style.id);
		assert.equal(text?.segments, undefined);
		assert.equal(read.styles[style.id]?.kind, "text");
	});

	it("la opacidad solo sale si no es 1", async () => {
		const root = frame(fake.currentPage, "Raíz");
		const faded = frame(root, "Tenue");
		faded.opacity = 0.5;
		const read = await run({ nodeId: root.id });
		assert.equal(byName(read, "Raíz").opacity, undefined);
		assert.equal(byName(read, "Tenue").opacity, 0.5);
	});
});

// Un set «Botón» con dos variantes de tamaño y una instancia en la raíz
function buttonSet() {
	const page = fake.currentPage;
	const set = fake.componentSet(page, "Botón", [
		{ Tamaño: "S", Tipo: "Primario" },
		{ Tamaño: "M", Tipo: "Primario" },
	]);
	const variant = set.children[1];
	assert.ok(variant);
	return { set, variant };
}

describe("design-context: las instancias", () => {
	it("una instancia lleva su componente, su variante, sus propiedades sin `#id` y lo que cambió; no se baja dentro", async () => {
		const { set, variant } = buttonSet();
		const root = frame(fake.currentPage, "Raíz");
		const inst = variant.createInstance();
		root.appendChild(inst);
		const labelKey = Object.keys(set.componentPropertyDefinitions).find((k) =>
			k.startsWith("Label#"),
		);
		assert.ok(labelKey);
		await fake.loadFontAsync({ family: "Inter", style: "Regular" });
		inst.setProperties({ [labelKey]: "Aceptar" });
		inst.children[0]?.markOverridden("fills");
		const read = await run({ nodeId: root.id });
		const node = read.nodes.find((n) => n.id === inst.id);
		assert.ok(node);
		assert.equal(node.type, "INSTANCE");
		assert.equal(node.instance?.component, set.key);
		assert.deepEqual(node.instance?.variant, { Tamaño: "M", Tipo: "Primario" });
		assert.equal(node.instance?.props["Label"], "Aceptar");
		assert.equal(node.instance?.props["Mostrar descripción"], true);
		assert.deepEqual(
			Object.keys(node.instance?.props ?? {}).filter((k) => k.includes("#")),
			[],
		);
		assert.ok(
			node.instance?.overridden.includes("label.fills"),
			JSON.stringify(node.instance?.overridden),
		);
		assert.equal(
			read.nodes.filter((n) => n.parent === inst.id).length,
			0,
			"no se baja dentro de la instancia",
		);
	});

	it("el componente se lee una sola vez por set y lleva sus variantes, sus propiedades y su clave de hoja", async () => {
		const { set, variant } = buttonSet();
		set.setSharedPluginData("fcc", "key", "fcc:sheet:button");
		const root = frame(fake.currentPage, "Raíz");
		root.appendChild(variant.createInstance());
		root.appendChild(variant.createInstance());
		const read = await run({ nodeId: root.id });
		assert.deepEqual(Object.keys(read.components), [set.key]);
		const component = read.components[set.key];
		assert.equal(component?.name, "Botón");
		assert.equal(component?.kind, "COMPONENT_SET");
		assert.equal(component?.remote, false);
		assert.deepEqual(component?.variants, {
			Tamaño: ["S", "M"],
			Tipo: ["Primario"],
		});
		assert.deepEqual(
			component?.properties.map((p) => [p.name, p.type, p.default]),
			[
				["Label", "TEXT", "Etiqueta"],
				["Mostrar descripción", "BOOLEAN", true],
				["Descripción", "TEXT", ""],
			],
		);
		assert.equal(component?.sheet, "button");
	});

	it("un componente suelto (no variante) se registra por su propia clave", async () => {
		const comp = fake.node(fake.currentPage, "COMPONENT", "Icono");
		const root = frame(fake.currentPage, "Raíz");
		root.appendChild(comp.createInstance());
		const read = await run({ nodeId: root.id });
		assert.equal(read.components[comp.key]?.kind, "COMPONENT");
		assert.deepEqual(read.components[comp.key]?.variants, {});
	});

	it("los huecos (SLOT) de una instancia sí se recorren: el hueco y lo que lleva dentro", async () => {
		const { variant } = buttonSet();
		const root = frame(fake.currentPage, "Raíz");
		const inst = variant.createInstance();
		root.appendChild(inst);
		const slot = fake.node(inst, "SLOT", "Contenido");
		fake.text(slot, "Dentro", "hola");
		const read = await run({ nodeId: root.id });
		assert.equal(byName(read, "Contenido").parent, inst.id);
		assert.equal(byName(read, "Dentro").parent, slot.id);
	});
});

describe("design-context: el origen (R-2)", () => {
	const keyed = (node: FakeNode, key: string) =>
		node.setSharedPluginData("fcc", "key", key);

	it("el nodo con una clave `fcc:` da su origen sin el prefijo", async () => {
		const root = frame(fake.currentPage, "Pantalla");
		keyed(root, "fcc:area:inicio/portada");
		const read = await run({ nodeId: root.id });
		assert.deepEqual(read.origin, { kind: "area", key: "inicio/portada" });
	});

	it("si el nodo no la lleva, vale la de su frame de primer nivel; screen, sheet y compose también", async () => {
		for (const [key, kind, rest] of [
			["fcc:screen:panel", "screen", "panel"],
			["fcc:sheet:button", "sheet", "button"],
			["fcc:compose:alta", "compose", "alta"],
		] as const) {
			fake = installFakeFigma();
			const top = frame(fake.currentPage, "Marco");
			keyed(top, key);
			const inner = frame(frame(top, "Medio"), "Hondo");
			const read = await run({ nodeId: inner.id });
			assert.deepEqual(read.origin, { kind, key: rest }, key);
		}
	});

	it("sin ninguna clave `fcc:` conocida no hay origen", async () => {
		const root = frame(fake.currentPage, "Raíz");
		keyed(root, "fcc:otra:cosa");
		const read = await run({ nodeId: root.id });
		assert.equal(read.origin, undefined);
	});
});

describe("design-context: un set como raíz (R-3)", () => {
	const setOf = () =>
		fake.componentSet(fake.currentPage, "Botón", [
			{ Tamaño: "S", Tipo: "Primario" },
			{ Tamaño: "S", Tipo: "Secundario" },
			{ Tamaño: "M", Tipo: "Primario" },
		]);

	it("sin `variant` recorre solo la variante por defecto; el resto va como tabla de variantes del componente", async () => {
		const set = setOf();
		const read = await run({ nodeId: set.id });
		assert.equal(read.root, set.id);
		assert.deepEqual(
			read.nodes.filter((n) => n.type === "COMPONENT").map((n) => n.name),
			["Tamaño=S, Tipo=Primario"],
		);
		assert.equal(read.nodes[0]?.type, "COMPONENT_SET");
		assert.equal(read.nodes[1]?.parent, set.id);
		assert.deepEqual(read.components[set.key]?.variants, {
			Tamaño: ["S", "M"],
			Tipo: ["Primario", "Secundario"],
		});
	});

	it("con `variant` recorre la pedida", async () => {
		const set = setOf();
		const read = await run({
			nodeId: set.id,
			variant: { Tamaño: "M" },
		});
		assert.deepEqual(
			read.nodes.filter((n) => n.type === "COMPONENT").map((n) => n.name),
			["Tamaño=M, Tipo=Primario"],
		);
	});

	it("una variante que no existe devuelve las propiedades y opciones válidas, sin recorrer nada", async () => {
		const set = setOf();
		const read = await runRaw({
			nodeId: set.id,
			variant: { Tamaño: "XL" },
		});
		assert.deepEqual(read.unknownVariant, {
			variants: { Tamaño: ["S", "M"], Tipo: ["Primario", "Secundario"] },
		});
		assert.equal(read.nodes, undefined);
	});

	it("el tope también vale dentro de la variante", async () => {
		const set = setOf();
		const read = await run({ nodeId: set.id, maxNodes: 2 });
		assert.equal(read.nodes.length, 2);
		assert.ok(read.truncated);
	});
});
