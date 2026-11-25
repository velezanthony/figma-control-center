import { projectConfigError } from "#domain/figma-error.ts";
import type { makeSheetsPlan } from "../sheets-plan.ts";

// Para los tests de herramientas que no arman planes desde hojas pero montan los casos de uso enteros
export const unusedSheetsPlan: ReturnType<typeof makeSheetsPlan> = () =>
	Promise.resolve({
		kind: "error",
		error: projectConfigError("(prueba)", "sheets", "no se usa aquí"),
	});
