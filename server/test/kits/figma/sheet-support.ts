// Lo común de los tests de las hojas de componentes: el archivo falso del pintor con las
// variables del estilo de la hoja, y un plan component@1 con variantes escritas a mano. Nombres genéricos.
import { componentPlanExample } from "../../contracts/component.ts";
import type { FakeFigma, FakeNode } from "./fake-figma.ts";
import {
	frame,
	icons,
	planMap,
	svg,
	text,
	type World,
	world,
} from "./screen-support.ts";

type Rec = Record<string, unknown>;

export { frame, icons, svg, text };

export const PAGE_KEY = "fcc:sheet-page:button";
export const SCRATCH_KEY = "fcc:sheet-scratch:button";
export const SET_KEY = "fcc:sheet:button";

// Las variables que sheets@1 nombra en `style`, en una colección propia
const STYLE_VARIABLES = [
	"brand/50",
	"brand/600",
	"white",
	"text/secondary",
	"danger/600",
	"text/primary",
	"text/muted",
	"border",
] as const;

export function sheetWorld(): World {
	const w = world();
	w.fake.strictProperties = true;
	w.fake.hugLayout = true;
	const color = { r: 0.2, g: 0.4, b: 0.6 };
	w.fake.collection(
		"Hoja",
		1,
		Object.fromEntries(STYLE_VARIABLES.map((n) => [n, color])),
	);
	return w;
}

export const STYLE = {
	header: { fill: "brand/50", text: "brand/600" },
	card: { fill: "white" },
	texts: {
		description: "text/secondary",
		bug: "danger/600",
		tag: "text/primary",
		rowLabel: "text/secondary",
		colLabel: "text/muted",
	},
	bug: { prefix: "Fallo conocido: ", setPrefix: "FALLO CONOCIDO: " },
	matrix: { stroke: "border" },
};

// Dos variantes de un botón (una raíz de marco con un texto) y las etiquetas de su matriz
export const button = (label = "Botón", w = 80): Rec =>
	frame({ tag: "button", w, h: 32, disp: "flex", cls: "btn" }, [
		text(label, { w: w - 20, h: 20 }),
	]);

type PlanOver = {
	variants?: { props: Record<string, string>; root: unknown[] }[];
	sheet?: Rec;
	target?: Rec;
	rules?: string[];
	fingerprints?: Rec;
	icons?: Rec;
	images?: Rec;
	matrix?: Rec;
	map?: Rec;
};

export function sheetPlanOf(over: PlanOver = {}): Rec {
	const base = structuredClone(componentPlanExample()) as Rec;
	const variants = over.variants ?? [
		{ props: { variant: "primary", size: "sm" }, root: [button()] },
		{ props: { variant: "primary", size: "lg" }, root: [button("Botón", 120)] },
		{ props: { variant: "danger", size: "sm" }, root: [button()] },
	];
	const map = over.map ?? planMap();
	return {
		...base,
		sheet: {
			key: "button",
			screen: "cmp-button",
			title: "Button",
			page: { name: "   Button" },
			description: "Botón con variantes",
			tag: "<ui-button>",
			...over.sheet,
		},
		style: structuredClone(STYLE),
		target: over.target ?? {
			page: { name: "   Button", key: PAGE_KEY },
			set: { name: "Button", key: SET_KEY },
		},
		variants,
		images: over.images ?? {},
		icons: over.icons ?? {},
		map: {
			...map,
			tokens: {
				...(map["tokens"] as Rec),
				collections: ["Base", "Semanticos", "Hoja"],
			},
		},
		rules: over.rules ?? [],
		...(over.fingerprints !== undefined && {
			fingerprints: over.fingerprints,
		}),
		matrix: over.matrix ?? {
			rows: ["variant=primary", "variant=danger"],
			columns: ["size=sm", "size=lg"],
			cells: [[0, 1], [2]],
		},
		warnings: [],
	};
}

export const assetsOf = (
	plan: unknown,
	extra: Record<string, Uint8Array> = {},
): Record<string, Uint8Array> => ({
	plan: new TextEncoder().encode(JSON.stringify(plan)),
	...extra,
});

export const key = (n: {
	getSharedPluginData(ns: string, k: string): string;
}) => n.getSharedPluginData("fcc", "key");

export const setOf = (fake: FakeFigma, pageName = "   Button"): FakeNode => {
	const page = fake.root.children.find((p) => p.name === pageName);
	const set = page?.findOne((n) => n.type === "COMPONENT_SET");
	if (set === null || set === undefined) throw new Error("no hay set");
	return set;
};
