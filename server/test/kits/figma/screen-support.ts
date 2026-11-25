// Lo común de los tests del pintor: un archivo falso con colecciones de variables, estilos de
// texto y de efecto, iconos y fuentes, y un plan screen@1 con sus nodos escritos a mano. Nombres genéricos.

import { createKit } from "../../../../kits/figma/kit.ts";
import { mapExample } from "../../contracts/map.ts";
import { screenPlanExample } from "../../contracts/screen.ts";
import type { FakeFigma, FakeNode, FakeVariable } from "./fake-figma.ts";
import { installFakeFigma } from "./fake-figma.ts";

type Rec = Record<string, unknown>;

export const SANS = "Fuente Sans";
export const MONO = "Fuente Mono";

// El mapa del ejemplo, tal como llega dentro del plan (sin `contract` ni la ruta del catálogo)
export function planMap(over: Rec = {}): Rec {
	const { contract: _c, ...map } = structuredClone(mapExample()) as Rec & {
		icons: Rec;
	};
	const { catalog: _cat, ...icons } = map.icons;
	return { ...map, icons, ...over };
}

type PlanOver = {
	root?: unknown[];
	map?: Rec;
	images?: Rec;
	icons?: Rec;
	props?: Rec;
	target?: Rec;
	// F4b: las reglas que se prueban en la pantalla, las huellas de sus componentes hoja y las clases genéricas
	rules?: string[];
	fingerprints?: Rec;
	generic?: string[];
};

export function planOf(over: PlanOver = {}): Rec {
	const base = structuredClone(screenPlanExample()) as Rec;
	return {
		...base,
		root: over.root ?? [],
		map: over.map ?? planMap(),
		images: over.images ?? {},
		icons: over.icons ?? {},
		props: over.props ?? {},
		warnings: [],
		...(over.target !== undefined && { target: over.target }),
		...(over.rules !== undefined && { rules: over.rules }),
		...(over.fingerprints !== undefined && { fingerprints: over.fingerprints }),
		...(over.generic !== undefined && {
			map: {
				...((over.map ?? planMap()) as Rec),
				components: { genericClasses: over.generic },
			},
		}),
	};
}

let seq = 0;
const id = () => String(++seq).padStart(8, "0");

export const FONT = (extra: Rec = {}) => ({
	fam: "sans-serif",
	size: 14,
	weight: "400",
	lh: "20px",
	ls: "normal",
	tt: "none",
	td: "none",
	fs: "normal",
	ta: "left",
	ws: "normal",
	color: [17, 24, 39, 1],
	...extra,
});

export const frame = (extra: Rec = {}, kids: unknown[] = []): Rec => ({
	id: id(),
	path: "0",
	t: "frame",
	tag: "div",
	cls: "",
	x: 0,
	y: 0,
	w: 400,
	h: 100,
	disp: "block",
	dir: "row",
	wrap: "nowrap",
	jc: "normal",
	ai: "normal",
	gap: 0,
	rgap: 0,
	pad: [0, 0, 0, 0],
	bg: null,
	bw: [0, 0, 0, 0],
	bc: null,
	rad: [0, 0, 0, 0],
	ov: "visible",
	font: FONT(),
	kids,
	...extra,
});

export const text = (txt: string, extra: Rec = {}): Rec => ({
	id: id(),
	path: "0",
	t: "text",
	txt,
	x: 0,
	y: 0,
	w: 60,
	h: 20,
	lines: 1,
	font: FONT(),
	...extra,
});

export const svg = (extra: Rec = {}): Rec => ({
	id: id(),
	path: "0",
	t: "svg",
	svg: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>',
	key: "M0 0L1 1",
	x: 0,
	y: 0,
	w: 24,
	h: 24,
	color: [17, 24, 39, 1],
	...extra,
});

export const img = (ref: string, extra: Rec = {}): Rec => ({
	id: id(),
	path: "0",
	t: "img",
	ref,
	x: 0,
	y: 0,
	w: 40,
	h: 20,
	rad: [0, 0, 0, 0],
	...extra,
});

// El archivo falso con todo lo que un plan de ejemplo necesita
export type World = {
	fake: FakeFigma;
	kit: ReturnType<typeof createKit>;
	page: FakeNode;
	variable(name: string): FakeVariable;
};

export function world(options: { fonts?: boolean } = {}): World {
	const fake = installFakeFigma();
	fake.strictText = true;
	fake.strictLayout = true;
	fake.autoLayout = true;
	const kit = createKit();
	// El valor de un color sale de Figma como RGBA, aunque se guarde como RGB (trampa 1, medida)
	fake.collection("Base", 1, {
		"gray/50": { r: 250 / 255, g: 250 / 255, b: 250 / 255 },
		"gray/900": { r: 17 / 255, g: 24 / 255, b: 39 / 255 },
		"brand/500": { r: 255 / 255, g: 102 / 255, b: 0 },
		"radius/lg": 8,
		"radius/full": 9999,
		"spacing/4": 16,
	});
	fake.collection("Semanticos", 1, {
		"text/primary": { r: 17 / 255, g: 24 / 255, b: 39 / 255 },
		"surface/card": { r: 1, g: 1, b: 1 },
	});
	if (options.fonts !== false) {
		for (const family of [SANS, MONO]) {
			for (const style of ["Regular", "Medium", "SemiBold", "Italic"]) {
				fake.loadedFontsToLoad.add(`${family}/${style}`);
			}
		}
	}
	const page = fake.page("Pantalla");
	fake.currentPage = page;
	return { fake, kit, page, variable: (n) => fake.variableByName(n) };
}

export type Assets = Record<string, Uint8Array>;

// Pinta un plan con estos nodos en la página abierta del archivo falso y devuelve el marco raíz
export async function paint(
	w: World,
	root: unknown[],
	over: PlanOver = {},
	assets: Assets = {},
	recognize: unknown = null,
) {
	const plan = planOf({ ...over, root });
	const painted = await w.kit.screen.paint(
		plan as never,
		assets,
		recognize as never,
	);
	return { ...painted, root: painted.root as unknown as FakeNode, plan };
}

// Los estilos de texto de uso común en los tests
export function styles(fake: FakeFigma): void {
	fake.textStyle(SANS, "Regular", 14, { lineHeight: 20 });
	fake.textStyle(SANS, "SemiBold", 14, { lineHeight: 20 });
	fake.textStyle(MONO, "Regular", 12, {
		lineHeight: 16,
		letterSpacing: 0.5,
		textCase: "UPPER",
	});
}

// Los iconos: una página «Iconos» con el componente «icons/plus»
export function icons(fake: FakeFigma): FakeNode {
	const page = fake.page("Iconos");
	const plus = fake.node(page, "COMPONENT", "icons/plus");
	plus.resize(24, 24);
	const stroke = fake.node(plus, "VECTOR", "trazo");
	stroke.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 1 }];
	return plus;
}

// F4b: un módulo recognize@1 con estas reglas
export const recognizer = (rules: Rec, extra: Rec = {}): Rec => ({
	contract: "recognize@1",
	rules,
	...extra,
});

// Una página de componentes con un set «Boton» (tamaños sm y md, 80 x 32 cada variante) y otro «Insignia»
export function catalog(w: World) {
	// los textos de un componente nacen con la fuente por defecto del archivo falso
	w.fake.loadedFontsToLoad.add("Inter/Regular");
	const page = w.fake.page("Componentes");
	const button = w.fake.componentSet(page, "Boton", [
		{ size: "sm" },
		{ size: "md" },
	]);
	for (const v of button.children) v.resize(80, 32);
	return { page, button };
}
