// Un paso del kit: el servidor arma su código y sus params desde areas@1, así que areas.json es la
// única fuente y un manifiesto solo nombra el área (D-3). Puro: no lee nada, recibe el proyecto ya cargado.
import type { Area, AreasFile, LinkRules, Shared } from "#domain/areas.ts";
import type { FigmaError } from "#domain/figma-error.ts";
import { projectConfigError } from "#domain/figma-error.ts";
import { type KitStep, kitStepCode } from "#domain/step.ts";
import type { ComposePlanRun, ComposeStepParams } from "./compose-plan.ts";
import type { LoadedProject } from "./ports/project-config.ts";
import type { ScreenPlanRun, ScreenStepParams } from "./screen-plan.ts";
import type { SheetPlanRun, SheetStepParams } from "./sheet-plan.ts";

// Lo que recibe el kit como `params`: el área entera, las reglas de enlaces y los grupos con alguna entrada de esa área
export type KitStepParams = {
	readonly area: Area;
	readonly linkRules: LinkRules;
	readonly shared: readonly Shared[];
};

export type KitStepRun = {
	readonly code: string;
	readonly params:
		| KitStepParams
		| ScreenStepParams
		| SheetStepParams
		| ComposeStepParams;
	// Imagen de relleno (como está escrita en areas.json) → su ruta real; solo `kit/fill-image@1` las lleva
	readonly assets: Readonly<Record<string, string>> | undefined;
	// Solo `kit/build-screen@1`: lo que el historial de intentos guarda (el plan, map.json y recognize.js) y el código fijo del
	// paso, sin el módulo (que ya es su propio papel)
	readonly contents?:
		| ScreenPlanRun["contents"]
		| SheetPlanRun["contents"]
		| ComposePlanRun["contents"]
		| undefined;
	readonly attemptStep?: string | undefined;
};

export type KitStepResolution =
	| { readonly kind: "ok"; readonly run: KitStepRun }
	| { readonly kind: "no-areas"; readonly error: FigmaError }
	| { readonly kind: "unknown-area"; readonly message: string };

export const paramsOfArea = (areas: AreasFile, area: Area): KitStepParams => ({
	area,
	linkRules: areas.linkRules,
	shared: (areas.shared ?? []).filter((group) =>
		group.from.some((entry) => entry.area === area.name),
	),
});

export function resolveKitStep(
	step: KitStep,
	areaName: string,
	project: LoadedProject,
): KitStepResolution {
	if (project.areas === null) {
		return {
			kind: "no-areas",
			error: projectConfigError(
				project.file,
				"areas",
				"el proyecto no declara `areas`: añade la ruta de su areas@1 a figma-control-center.json",
			),
		};
	}
	const area = project.areas.areas.find((a) => a.name === areaName);
	if (area === undefined) {
		return {
			kind: "unknown-area",
			message: `el área «${areaName}» no está en areas@1 (áreas: ${project.areas.areas.map((a) => a.name).join(", ")}).`,
		};
	}
	const assets: Record<string, string> = {};
	if (step === "kit/fill-image@1") {
		for (const fill of area.fills ?? []) {
			const path = project.areaAssets[fill.asset];
			if (path !== undefined) assets[fill.asset] = path;
		}
	}
	return {
		kind: "ok",
		run: {
			code: kitStepCode(step),
			params: paramsOfArea(project.areas, area),
			assets: Object.keys(assets).length > 0 ? assets : undefined,
		},
	};
}
