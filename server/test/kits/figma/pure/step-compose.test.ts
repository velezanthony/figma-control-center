// kit.steps.compose: un compose@1 pintado con instancias de hojas, variables y estilos.
// Frame por clave `fcc:compose:<clave>` que se rehace sin duplicar; nada se escribe si falta algo; step@1 válido.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StepResultSchema } from "#adapters/contracts/step.ts";
import { COMPOSE_CONTRACT, type ComposeFile } from "#domain/compose.ts";
import type { ComposeParams } from "../../../../../kits/figma/steps/compose.ts";
import type { FakeFigma, FakeNode } from "../fake-figma.ts";
import { setup } from "../support.ts";

const COLOR = { r: 0.9, g: 0.4, b: 0.1 };
const key = (n: FakeNode): string => n.getSharedPluginData("fcc", "key");
const bound = (n: FakeNode, field: string): string | undefined =>
	n.boundVariables[field]?.id;
const paintVariable = (n: FakeNode, field = "fills"): string | undefined =>
	(
		(n as unknown as Record<string, unknown[]>)[field]?.[0] as
			| { boundVariables?: { color?: { id: string } } }
			| undefined
	)?.boundVariables?.color?.id;

function world() {
	const { fake, kit } = setup();
	fake.strictText = true;
	// Figma real da a cada frame nuevo un relleno blanco que no es de ninguna variable (medido en el archivo de pruebas)
	const createFrame = fake.createFrame.bind(fake);
	fake.createFrame = () => {
		const frame = createFrame();
		frame.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
		return frame;
	};
	fake.collection("Tokens", 1, {
		"spacing/2": 8,
		"spacing/4": 16,
		"spacing/6": 24,
		"radius/md": 6,
		surface: COLOR,
		"brand/500": COLOR,
		"text/primary": COLOR,
	});
	fake.textStyle("Inter", "Bold", 24).name = "Título/L";
	fake.textStyle("Inter", "Regular", 14).name = "Texto/S";
	const buttons = fake.componentSet(fake.page("Button"), "Button", [
		{ tipo: "primary" },
		{ tipo: "ghost" },
	]);
	buttons.setSharedPluginData("fcc", "key", "fcc:sheet:button");
	return { fake, kit, buttons };
}

const compose = (root: ComposeFile["root"], extra = {}): ComposeFile => ({
	contract: COMPOSE_CONTRACT,
	key: "alta",
	title: "Alta",
	target: { page: "Pruebas", width: 640 },
	root,
	...extra,
});

const FORM: ComposeFile["root"] = {
	stack: "VERTICAL",
	gap: "spacing/4",
	padding: ["spacing/6", "spacing/4"],
	fill: "surface",
	radius: "radius/md",
	name: "Formulario",
	children: [
		{ text: "Alta", style: "Título/L", color: "text/primary" },
		{
			use: "button",
			variant: { tipo: "ghost" },
			props: { Label: "Guardar", "Mostrar descripción": false },
			name: "Guardar",
		},
	],
};

const paramsOf = (c: ComposeFile): ComposeParams => ({
	compose: c,
	sheets: [{ key: "button", title: "Button" }],
});

// Lo que pinta el paso: los hijos del frame, a cualquier profundidad, sin entrar en la estructura propia de una instancia
// (solo en el contenido que se metió en sus slots)
function painted(node: FakeNode): FakeNode[] {
	return node.children.flatMap((child) => [
		child,
		...(child.type === "INSTANCE"
			? child
					.descendants()
					.filter((d) => d.type === "SLOT")
					.flatMap((slot) => slot.children.flatMap((c) => [c, ...painted(c)]))
			: painted(child)),
	]);
}

const frameOf = (fake: FakeFigma): FakeNode => {
	const page = fake.root.children.find((p) => p.name === "Pruebas");
	assert.ok(page, "la página de pruebas");
	const frame = page.children.find((n) => key(n) === "fcc:compose:alta");
	assert.ok(frame, "el frame del compose");
	return frame;
};

const run = (kit: ReturnType<typeof setup>["kit"], c = compose(FORM)) =>
	kit.steps.compose(paramsOf(c) as never, {});

describe("kit.steps.compose", () => {
	it("crea la página del target y el frame con su clave y el ancho pedido; cumple step@1", async () => {
		const { fake, kit } = world();
		const result = await run(kit);
		assert.equal(StepResultSchema.safeParse(result).success, true);
		const frame = frameOf(fake);
		assert.equal(frame.name, "Alta");
		assert.equal(frame.width, 640);
		const page = frame.parent as FakeNode;
		// La página que crea el paso lleva su clave, para poder reconocerla (y limpiarla) después
		assert.equal(key(page), "fcc:compose-page:alta");
		assert.ok(result.createdNodeIds.includes(page.id));
		assert.ok(result.createdNodeIds.includes(frame.id));
		for (const d of painted(frame))
			assert.ok(result.createdNodeIds.includes(d.id), d.name);
		assert.equal((result.report as { frameId: string }).frameId, frame.id);
	});

	it("el stack raíz se aplica al frame: disposición, espacio, relleno y radios ligados a sus variables", async () => {
		const { fake, kit } = world();
		await run(kit);
		const frame = frameOf(fake);
		assert.equal(frame.layoutMode, "VERTICAL");
		assert.equal(
			bound(frame, "itemSpacing"),
			fake.variableByName("spacing/4").id,
		);
		assert.equal(frame.itemSpacing, 16);
		assert.equal(paintVariable(frame), fake.variableByName("surface").id);
		for (const corner of [
			"topLeftRadius",
			"topRightRadius",
			"bottomRightRadius",
			"bottomLeftRadius",
		])
			assert.equal(bound(frame, corner), fake.variableByName("radius/md").id);
	});

	it("un padding de dos valores es vertical y horizontal, como en CSS", async () => {
		const { fake, kit } = world();
		await run(kit);
		const frame = frameOf(fake);
		const v6 = fake.variableByName("spacing/6").id;
		const v4 = fake.variableByName("spacing/4").id;
		assert.deepEqual(
			[
				bound(frame, "paddingTop"),
				bound(frame, "paddingRight"),
				bound(frame, "paddingBottom"),
				bound(frame, "paddingLeft"),
			],
			[v6, v4, v6, v4],
		);
		assert.equal(frame.paddingTop, 24);
		assert.equal(frame.paddingLeft, 16);
	});

	it("un stack anidado es un frame propio con su nombre, su disposición y sus tokens", async () => {
		const { fake, kit } = world();
		await run(
			kit,
			compose({
				stack: "VERTICAL",
				children: [
					{
						stack: "HORIZONTAL",
						gap: "spacing/2",
						padding: "spacing/4",
						fill: "brand/500",
						sizing: { h: "FILL", v: "HUG" },
						name: "Fila",
						children: [],
					},
				],
			}),
		);
		const row = frameOf(fake).children[0] as FakeNode;
		assert.equal(row.name, "Fila");
		assert.equal(row.layoutMode, "HORIZONTAL");
		assert.equal(row.layoutSizingHorizontal, "FILL");
		assert.equal(
			bound(row, "itemSpacing"),
			fake.variableByName("spacing/2").id,
		);
		assert.equal(
			bound(row, "paddingLeft"),
			fake.variableByName("spacing/4").id,
		);
		assert.equal(paintVariable(row), fake.variableByName("brand/500").id);
	});

	it("un texto lleva su estilo, su contenido y el color ligado", async () => {
		const { fake, kit } = world();
		await run(kit);
		const title = frameOf(fake).children[0] as FakeNode;
		assert.equal(title.type, "TEXT");
		assert.equal(title.characters, "Alta");
		assert.equal(title.textStyleId, fake.textStyles[0]?.id);
		assert.equal(paintVariable(title), fake.variableByName("text/primary").id);
	});

	it("un texto sin color avisa TEXT_WITHOUT_COLOR: el relleno por defecto no es de una variable", async () => {
		const { kit } = world();
		const result = await run(
			kit,
			compose({
				stack: "VERTICAL",
				children: [{ text: "x", style: "Texto/S" }],
			}),
		);
		assert.deepEqual(
			result.warnings?.map((w) => w.code),
			["TEXT_WITHOUT_COLOR"],
		);
	});

	it("una instancia de hoja: la variante pedida, el texto de su prop y el «Mostrar» apagado", async () => {
		const { fake, kit, buttons } = world();
		await run(kit);
		const inst = frameOf(fake).children[1] as FakeNode;
		assert.equal(inst.type, "INSTANCE");
		assert.equal(inst.name, "Guardar");
		assert.equal(inst.main?.parent, buttons);
		assert.equal(inst.main?.variantProperties?.["tipo"], "ghost");
		const label = inst.descendants().find((d) => d.name === "label");
		assert.equal(label?.characters, "Guardar");
		const desc = inst.descendants().find((d) => d.name === "desc");
		assert.equal(desc?.visible, false);
	});

	it("un «Mostrar …» que el compose no nombra se queda como lo trae el set: nada se apaga por su cuenta", async () => {
		const { fake, kit } = world();
		await run(
			kit,
			compose({
				stack: "VERTICAL",
				children: [{ use: "button", props: { Label: "Guardar" } }],
			}),
		);
		const inst = frameOf(fake).children[0] as FakeNode;
		const desc = inst.descendants().find((d) => d.name === "desc");
		assert.equal(desc?.visible, true);
	});

	it("encuentra el set por la clave fcc:sheet:, y sin ella por el título de la hoja", async () => {
		const { fake, kit, buttons } = world();
		buttons.setSharedPluginData("fcc", "key", "");
		fake.componentSet(fake.page("Otra"), "Button vecino", [
			{ tipo: "primary" },
		]);
		await run(kit);
		const inst = frameOf(fake).children[1] as FakeNode;
		assert.equal(inst.main?.parent, buttons);
	});

	it("un slot recibe el contenido como clon y el original no queda suelto en el frame", async () => {
		const { fake, kit, buttons } = world();
		for (const variant of buttons.children) variant.createSlot().name = "ayuda";
		const root: ComposeFile["root"] = {
			stack: "VERTICAL",
			children: [
				{
					use: "button",
					slots: {
						ayuda: [{ text: "Nota", style: "Texto/S", color: "text/primary" }],
					},
				},
			],
		};
		const result = await run(kit, compose(root));
		const frame = frameOf(fake);
		assert.equal(frame.children.length, 1);
		const inst = frame.children[0] as FakeNode;
		const slot = inst.descendants().find((d) => d.type === "SLOT") as FakeNode;
		assert.equal(slot.children[0]?.characters, "Nota");
		const created = new Set(result.createdNodeIds);
		for (const d of painted(frame))
			assert.ok(created.has(d.id), `${d.name} sin declarar`);
		assert.ok(
			(result.removedNodeIds ?? []).length === 0 ||
				(result.removedNodeIds ?? []).every((id) => !created.has(id)),
		);
	});

	it("una página que ya existía no se etiqueta: es de quien la hizo", async () => {
		const { fake, kit } = world();
		const page = fake.page("Pruebas");
		await run(kit);
		assert.equal(key(page), "");
		assert.ok(page.children.some((n) => key(n) === "fcc:compose:alta"));
	});

	it("relanzar no duplica: la misma página, el mismo frame con el mismo id y su contenido rehecho", async () => {
		const { fake, kit } = world();
		await run(kit);
		const first = frameOf(fake);
		const id = first.id;
		const before = first.children.map((c) => c.id);
		const result = await run(kit);
		const frame = frameOf(fake);
		assert.equal(frame.id, id);
		assert.equal(
			fake.root.children.filter((p) => p.name === "Pruebas").length,
			1,
		);
		assert.equal(frame.children.length, 2);
		assert.equal(
			frame.children.some((c) => before.includes(c.id)),
			false,
		);
		assert.deepEqual(result.removedNodeIds?.sort(), [...before].sort());
		assert.equal(StepResultSchema.safeParse(result).success, true);
	});

	it("si falta algo (variable, estilo o set) falla con todo lo que falta y no escribe nada", async () => {
		const { fake, kit } = world();
		const pages = fake.root.children.length;
		await assert.rejects(
			run(
				kit,
				compose({
					stack: "VERTICAL",
					gap: "spacing/99",
					children: [
						{ text: "x", style: "Nada", color: "text/primary" },
						{ use: "button" },
						{ use: "fantasma" },
					],
				}),
			),
			(e: Error) =>
				/COMPOSE_NOT_FOUND/.test(e.message) &&
				/spacing\/99/.test(e.message) &&
				/Nada/.test(e.message) &&
				/fantasma/.test(e.message),
		);
		assert.equal(fake.root.children.length, pages);
	});

	it("un frame sin relleno no deja el blanco por defecto: relleno vacío, nada suelto", async () => {
		const { fake, kit } = world();
		await run(
			kit,
			compose({
				stack: "VERTICAL",
				children: [{ stack: "HORIZONTAL", children: [] }],
			}),
		);
		const frame = frameOf(fake);
		assert.deepEqual(frame.fills, []);
		assert.deepEqual((frame.children[0] as FakeNode).fills, []);
	});

	it("un `sizing` en la raíz se avisa: el ancho lo manda el target", async () => {
		const { kit } = world();
		const result = await run(
			kit,
			compose({
				stack: "VERTICAL",
				sizing: { h: "FILL", v: "HUG" },
				children: [],
			}),
		);
		assert.deepEqual(
			result.warnings?.map((w) => w.code),
			["ROOT_SIZING_IGNORED"],
		);
	});

	it("con `target.height` el alto es fijo; sin él, se ajusta al contenido", async () => {
		const { fake, kit } = world();
		await run(
			kit,
			compose(FORM, { target: { page: "Pruebas", width: 640, height: 480 } }),
		);
		let frame = frameOf(fake);
		assert.equal(frame.height, 480);
		assert.equal(frame.primaryAxisSizingMode, "FIXED");
		await run(kit);
		frame = frameOf(fake);
		assert.equal(frame.primaryAxisSizingMode, "AUTO");
	});

	it("la raíz que no es un stack (una hoja) entra como único hijo de un frame vertical", async () => {
		const { fake, kit } = world();
		await run(kit, compose({ use: "button", name: "Solo" }));
		const frame = frameOf(fake);
		assert.equal(frame.layoutMode, "VERTICAL");
		assert.equal(frame.children.length, 1);
		assert.equal(frame.children[0]?.name, "Solo");
	});

	it("un frame nuevo se pone a la derecha de lo que ya hay en la página, sin pisarlo", async () => {
		const { fake, kit } = world();
		const page = fake.page("Pruebas");
		const other = fake.node(page, "FRAME", "otro");
		other.x = 0;
		other.width = 300;
		await run(kit);
		const frame = frameOf(fake);
		assert.ok(frame.x >= 300, `x=${frame.x}`);
	});
});
