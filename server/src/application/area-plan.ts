// El plan de un `figma_build { areas }`: por área, en el orden de la lista,
// primero un build-screen por cada pantalla con captura válida (si el proyecto declara `map`), después place → share (si el área
// sale en algún grupo compartido) → links (si tiene enlaces o punto de inicio) → fill-image (si tiene rellenos). Es el mismo
// plan que un manifiesto escrito a mano con esos pasos `use`.
import type { Area, AreasFile } from "#domain/areas.ts";
import { type BuildPlan, kitPlanStep, type PlanStep } from "#domain/build.ts";
import type { FigmaError } from "#domain/figma-error.ts";
import { SCRIPT_FORMAT } from "#domain/script-format.ts";
import {
	type AreaKitStep,
	kitStepLabel,
	SCREEN_KIT_STEP,
} from "#domain/step.ts";
import { type KitStepParams, resolveKitStep } from "./kit-step.ts";
import type { ProjectConfigSource } from "./ports/project-config.ts";
import type { WebCaptureStore } from "./ports/web-capture-store.ts";

export type AreaPlanResult =
	| { readonly kind: "plan"; readonly plan: BuildPlan }
	| { readonly kind: "usage"; readonly message: string }
	| { readonly kind: "error"; readonly error: FigmaError };

const stepsOf = (file: AreasFile, area: Area): AreaKitStep[] => {
	const steps: AreaKitStep[] = ["kit/place@1"];
	if ((file.shared ?? []).some((g) => g.from.some((f) => f.area === area.name)))
		steps.push("kit/share@1");
	if ((area.links ?? []).length > 0 || area.flowStart !== undefined)
		steps.push("kit/links@1");
	if ((area.fills ?? []).length > 0) steps.push("kit/fill-image@1");
	return steps;
};

export function makeAreaPlan(deps: {
	readonly project: ProjectConfigSource;
	// Las capturas de la web: sin él (o sin `map`) el plan no pinta pantallas
	readonly store?: WebCaptureStore | undefined;
}) {
	return async (names: readonly string[]): Promise<AreaPlanResult> => {
		const loaded = await deps.project.load();
		if (!loaded.ok) return { kind: "error", error: loaded.error };
		const project = loaded.value;
		const steps: PlanStep[] = [];
		for (const name of names) {
			// «no hay areas» y «área desconocida» salen de la misma resolución que usa run-build
			const probe = resolveKitStep("kit/place@1", name, project);
			if (probe.kind === "no-areas")
				return { kind: "error", error: probe.error };
			if (probe.kind === "unknown-area")
				return { kind: "usage", message: probe.message };
			const area = (probe.run.params as KitStepParams).area;
			if (project.map !== null && deps.store !== undefined) {
				for (const screen of area.screens) {
					if (screen.screen === undefined) continue;
					if ((await deps.store.latest(screen.screen)) === null) continue;
					steps.push(
						kitPlanStep(
							{ use: SCREEN_KIT_STEP, area: name, screen: screen.screen },
							SCRIPT_FORMAT.body,
						),
					);
				}
			}
			for (const step of stepsOf(project.areas as AreasFile, area)) {
				steps.push({
					file: kitStepLabel(step, name),
					format: SCRIPT_FORMAT.body,
					kit: { step, area: name },
				});
			}
		}
		return {
			kind: "plan",
			plan: { name: `areas: ${names.join(", ")}`, steps },
		};
	};
}
