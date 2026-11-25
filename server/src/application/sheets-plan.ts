// El plan de un `figma_build { sheets }`: un `kit/build-component@1` por hoja, en el orden de
// sheets@1 (las hojas que otras anidan, antes que ellas) y no en el de la lista. Una hoja sin captura válida de su
// pantalla no tiene paso y se devuelve en `skipped` con NO_SOURCE. Es el mismo plan que un manifiesto escrito a mano.
import { type BuildPlan, kitPlanStep } from "#domain/build.ts";
import type { FigmaError } from "#domain/figma-error.ts";
import { projectConfigError } from "#domain/figma-error.ts";
import { SCRIPT_FORMAT } from "#domain/script-format.ts";
import { SHEET_KIT_STEP } from "#domain/step.ts";
import type { ProjectConfigSource } from "./ports/project-config.ts";
import type { WebCaptureStore } from "./ports/web-capture-store.ts";

export const SHEET_NO_SOURCE = "NO_SOURCE";

export type SkippedSheet = {
	readonly sheet: string;
	readonly code: typeof SHEET_NO_SOURCE;
	readonly message: string;
};

export type SheetsPlanResult =
	| {
			readonly kind: "plan";
			readonly plan: BuildPlan;
			readonly skipped: readonly SkippedSheet[];
	  }
	| { readonly kind: "usage"; readonly message: string }
	| { readonly kind: "error"; readonly error: FigmaError };

export function makeSheetsPlan(deps: {
	readonly project: ProjectConfigSource;
	readonly store: WebCaptureStore;
}) {
	return async (keys: readonly string[]): Promise<SheetsPlanResult> => {
		const loaded = await deps.project.load();
		if (!loaded.ok) return { kind: "error", error: loaded.error };
		const project = loaded.value;
		if (project.sheets === null) {
			return {
				kind: "error",
				error: projectConfigError(
					project.file,
					"sheets",
					"el proyecto no declara `sheets`: añade la ruta de su sheets@1 a figma-control-center.json",
				),
			};
		}
		const known = project.sheets.sheets;
		const unknown = [...new Set(keys)].filter(
			(k) => !known.some((s) => s.key === k),
		);
		if (unknown.length > 0) {
			return {
				kind: "usage",
				message: `${unknown.map((k) => `la hoja «${k}»`).join(", ")} no está en sheets@1 (hojas: ${known.map((s) => s.key).join(", ")}).`,
			};
		}
		const steps: BuildPlan["steps"][number][] = [];
		const skipped: SkippedSheet[] = [];
		for (const sheet of known.filter((s) => keys.includes(s.key))) {
			if ((await deps.store.latest(sheet.screen)) === null) {
				skipped.push({
					sheet: sheet.key,
					code: SHEET_NO_SOURCE,
					message: `la pantalla «${sheet.screen}» de la hoja «${sheet.key}» no tiene captura válida de la web: captúrala con \`figma_capture\`.`,
				});
				continue;
			}
			steps.push(
				kitPlanStep(
					{ use: SHEET_KIT_STEP, sheet: sheet.key },
					SCRIPT_FORMAT.body,
				),
			);
		}
		if (steps.length === 0) {
			return {
				kind: "usage",
				message: `ninguna de las hojas pedidas tiene captura válida (${SHEET_NO_SOURCE}): ${skipped.map((s) => s.message).join(" ")}`,
			};
		}
		return {
			kind: "plan",
			plan: {
				name: `hojas: ${steps
					.map((s) => s.kit?.sheet)
					.filter((k) => k !== undefined)
					.join(", ")}`,
				steps,
			},
			skipped,
		};
	};
}
