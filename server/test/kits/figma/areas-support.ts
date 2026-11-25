// Lo común de los tests de los pasos del kit: un archivo falso con un área «Panel» (dos frames, su
// shell con una variante por pantalla y las páginas temporales de lo que habría construido el constructor) y los datos de
// areas@1 que los pasos reciben como `params`. Nombres genéricos: la herramienta no conoce ningún proyecto.
import type { Area, LinkRules, Shared } from "#domain/areas.ts";
import type { FakeFigma, FakeNode } from "./fake-figma.ts";

export const RULES: LinkRules = {
	clickable: {
		names: ["boton"],
		namePrefixes: ["enlace ·"],
		components: ["Boton"],
	},
	rows: { row: ["fila"], body: ["cuerpo"] },
	transition: { type: "DISSOLVE", easing: "EASE_OUT", duration: 0.2 },
};

export const PANEL: Area = {
	name: "Panel",
	page: "Panel",
	frame: { width: 1440, minHeight: 900, fill: "surface", clip: true },
	place: {
		mode: "replace-content",
		source: { pagePrefix: "tmp ", take: "first-variant", remove: true },
		unwrap: { holding: ["lateral", "barra"] },
		strokeScale: 0.8,
	},
	shell: {
		set: "Panel / Lateral",
		in: ["lateral", "barra"],
		variantProp: "activa",
		default: "inicio",
		fixed: { height: 900 },
	},
	main: ["principal", "contenido"],
	screens: [
		{ frame: "Inicio", shell: "inicio" },
		{ frame: "Detalle", shell: "detalle" },
	],
};

export const COVER: Area = {
	name: "Portada",
	page: "Portada",
	frame: { width: 1280, minHeight: 800 },
	place: {
		mode: "transplant",
		source: { pagePrefix: "tmp ", take: "first-component" },
		keep: ["Cabecera", "Pie"],
		drop: ["cabecera", "pie"],
	},
	screens: [{ frame: "Home" }],
};

export const PROFILE: Shared = {
	name: "Perfil",
	set: "Perfil / Contenido",
	page: { name: "Compartido", after: "Panel" },
	part: ["principal", "contenido"],
	variantProp: "area",
	from: [
		{ area: "Panel", frame: "Inicio", value: "panel" },
		{ area: "Otra", frame: "Inicio", value: "otra" },
	],
	sheet: { gap: 40, padding: 40 },
};

export const paramsOf = (
	area: Area,
	shared: readonly Shared[] = [],
): { area: Area; linkRules: LinkRules; shared: readonly Shared[] } => ({
	area,
	linkRules: RULES,
	shared,
});

export const surface = (fake: FakeFigma) =>
	fake.collection("Colores", 1, { surface: { r: 1, g: 1, b: 1 } });

// Un botón (por nombre pulsable) con su texto
export function button(
	fake: FakeFigma,
	parent: FakeNode,
	label: string,
	name = "boton",
): FakeNode {
	const b = fake.node(parent, "FRAME", name);
	fake.text(b, "t", label);
	return b;
}

// Lo que el constructor deja en una página temporal: un set con una variante que lleva `lateral` (con el shell viejo) y
// `principal` (con un botón «Ver detalle» y un borde de 0,8) dentro; con `wrapped`, dentro de un envoltorio
export function tempPage(
	fake: FakeFigma,
	prefix: string,
	frame: string,
	options: { wrapped?: boolean; layout?: "NONE" | "HORIZONTAL" } = {},
): { page: FakeNode; variant: FakeNode; main: FakeNode; aside: FakeNode } {
	const page = fake.page(`${prefix}${frame}`);
	const set = fake.node(page, "COMPONENT_SET", "Pantalla");
	const variant = fake.node(set, "COMPONENT", "estado=base");
	variant.layoutMode = options.layout ?? "HORIZONTAL";
	variant.itemSpacing = 0;
	variant.clipsContent = true;
	const holder = options.wrapped
		? fake.node(variant, "FRAME", "envoltorio")
		: variant;
	if (options.wrapped) {
		holder.layoutMode = "HORIZONTAL";
		holder.itemSpacing = 4;
	}
	const aside = fake.node(holder, "FRAME", "lateral");
	aside.width = 250;
	fake.node(aside, "FRAME", "shell viejo");
	const main = fake.node(holder, "FRAME", "principal");
	main.height = 700;
	button(fake, main, "Ver detalle");
	const bordered = fake.node(main, "RECTANGLE", "caja");
	bordered.strokes = [{ type: "SOLID" }];
	bordered.strokeTopWeight = 0.8;
	bordered.strokeLeftWeight = 2;
	if (options.wrapped) {
		const toast = fake.node(holder, "FRAME", "avisos");
		toast.resize(0, 0);
	}
	return { page, variant, main, aside };
}

export type PanelScene = {
	fake: FakeFigma;
	page: FakeNode;
	frames: Record<string, FakeNode>;
	shell: FakeNode;
};

// El archivo con el área «Panel» en su página: dos frames con algo viejo dentro y el set del shell
export function panelScene(fake: FakeFigma): PanelScene {
	surface(fake);
	const page = fake.page("Panel");
	const frames: Record<string, FakeNode> = {};
	for (const name of ["Inicio", "Detalle"]) {
		const f = fake.node(page, "FRAME", name);
		fake.node(f, "FRAME", `viejo de ${name}`);
		frames[name] = f;
	}
	const shell = fake.componentSet(page, "Panel / Lateral", [
		{ activa: "inicio" },
		{ activa: "detalle" },
	]);
	return { fake, page, frames, shell };
}

export const warningCodes = (result: { warnings?: { code: string }[] }) =>
	(result.warnings ?? []).map((w) => w.code);

// Un PNG mínimo con su cabecera (la firma y el trozo IHDR con el ancho y el alto); solo se lee la cabecera
export function png(width: number, height: number): Uint8Array {
	const bytes = new Uint8Array(33);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
	const view = new DataView(bytes.buffer);
	view.setUint32(16, width);
	view.setUint32(20, height);
	return bytes;
}
