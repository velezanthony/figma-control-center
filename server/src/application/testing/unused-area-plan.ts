import type { makeAreaPlan } from "#application/area-plan.ts";
import { projectConfigError } from "#domain/figma-error.ts";

// Para los tests de herramientas que no arman planes desde áreas pero montan los casos de uso enteros
export const unusedAreaPlan: ReturnType<typeof makeAreaPlan> = () =>
	Promise.resolve({
		kind: "error",
		error: projectConfigError("(prueba)", "areas", "no se usa aquí"),
	});
