// Contrato screen@1: el plan de una pantalla. Es un contrato PROPIO: su fuente es el esquema zod y
// docs/users/contracts.md, no una salida real.
// Vive en el servidor (#adapters/contracts/screen.ts, JSON Schema en schemas/screen.v1.json). El ejemplo se CONSTRUYE aquí
// y se valida al construirlo; los nombres son genéricos.
import { ScreenPlanSchema } from "#adapters/contracts/screen.ts";
import { SCREEN_CONTRACT } from "#domain/screen-plan.ts";
import { mapExample } from "./map.ts";

export const SCREEN_CONTRACT_SOURCES = Object.freeze([
	"docs/users/contracts.md (screen@1)",
	"schemas/screen.v1.json",
] as const);

const SHA = "a".repeat(64);
const SHA_MAP = "b".repeat(64);
const SHA_IMG = "c".repeat(64);

export const screenPlanExample = (): unknown => {
	const { contract: _contract, ...map } = mapExample() as {
		contract: string;
		icons: { catalog: string };
	} & Record<string, unknown>;
	const { catalog: _catalog, ...icons } = map.icons;
	return ScreenPlanSchema.parse({
		contract: SCREEN_CONTRACT,
		screen: "inicio",
		title: "Inicio",
		variant: 0,
		props: {},
		sources: {
			capture: {
				path: "web-captures/2026-11-12/inicio_101500.json",
				sha256: SHA,
			},
			map: { path: "map.json", sha256: SHA_MAP },
		},
		target: {
			page: { name: "   tmp Inicio", key: "fcc:screen-page:inicio" },
			frame: { name: "Inicio", key: "fcc:screen:inicio" },
		},
		root: [
			{
				id: "00000001",
				path: "0",
				t: "frame",
				tag: "main",
				w: 400,
				h: 100,
				kids: [
					{
						id: "00000002",
						path: "0/0",
						t: "img",
						w: 40,
						h: 40,
						ref: SHA_IMG,
					},
				],
			},
		],
		images: {
			[SHA_IMG]: { asset: SHA_IMG, width: 40, height: 40, type: "png" },
		},
		icons: { "M0 0": "plus" },
		map: { ...map, icons },
		warnings: [
			{ code: "ICON_KEY_UNKNOWN", nodeId: "00000002", message: "sin icono" },
		],
	});
};
