// Contrato component@1 (hojas de componentes): el plan de una hoja. Es un contrato PROPIO: su fuente es el esquema zod y
// docs/users/contracts.md.
// Vive en el servidor (#adapters/contracts/component.ts, JSON Schema en schemas/component.v1.json). El ejemplo se
// CONSTRUYE aquí y se valida al construirlo; los nombres son genéricos.
import { ComponentPlanSchema } from "#adapters/contracts/component.ts";
import { COMPONENT_CONTRACT } from "#domain/component-plan.ts";
import { mapExample } from "./map.ts";
import { sheetsExample } from "./sheets.ts";

export const COMPONENT_CONTRACT_SOURCES = Object.freeze([
	"docs/users/contracts.md (component@1)",
	"schemas/component.v1.json",
] as const);

const SHA = "a".repeat(64);
const SHA_MAP = "b".repeat(64);
const SHA_SHEETS = "d".repeat(64);
const SHA_IMG = "c".repeat(64);

export const componentPlanExample = (): unknown => {
	const { contract: _contract, ...map } = mapExample() as {
		contract: string;
		icons: { catalog: string };
	} & Record<string, unknown>;
	const { catalog: _catalog, ...icons } = map.icons;
	const sheets = sheetsExample() as { sheets: unknown[]; style: unknown };
	const root = [
		{
			id: "00000001",
			path: "0",
			t: "frame",
			tag: "button",
			w: 80,
			h: 40,
			kids: [
				{ id: "00000002", path: "0/0", t: "img", w: 40, h: 40, ref: SHA_IMG },
			],
		},
	];
	return ComponentPlanSchema.parse({
		contract: COMPONENT_CONTRACT,
		sheet: sheets.sheets[0],
		style: sheets.style,
		sources: {
			capture: {
				path: "web-captures/2026-11-12/cmp-button_101500.json",
				sha256: SHA,
			},
			sheets: { path: "sheets.json", sha256: SHA_SHEETS },
			map: { path: "map.json", sha256: SHA_MAP },
		},
		target: {
			page: {
				name: "   Button",
				key: "fcc:sheet-page:button",
				after: "   Badge",
				section: "Atomos",
			},
			set: { name: "Button", key: "fcc:sheet:button" },
		},
		variants: [
			{ props: { variant: "primary", size: "sm" }, root },
			{ props: { variant: "primary", size: "lg" }, root },
		],
		images: {
			[SHA_IMG]: { asset: SHA_IMG, width: 40, height: 40, type: "png" },
		},
		icons: { "M0 0": "plus" },
		map: { ...map, icons },
		matrix: {
			rows: ["variant=primary"],
			columns: ["size=sm", "size=lg"],
			cells: [[0, 1]],
		},
		warnings: [
			{ code: "ICON_KEY_UNKNOWN", nodeId: "00000002", message: "sin icono" },
		],
	});
};
