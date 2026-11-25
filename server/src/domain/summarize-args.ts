import type { ArgsSummary } from "./activity.ts";
import { type KitStep, kitStepLabel } from "./step.ts";

export const MAX_ARG_CHARS = 300;
const ELLIPSIS = "…";

// Único argumento que lleva contenido (el script): el resto son rutas, ids y números
const CODE_KEY = "code";

// Lista de pasos de figma_build: se guarda cuántos son y el primer fichero (la lista entera no es un escalar)
const STEPS_KEY = "steps";

// Listas de texto de las lecturas (figma_export, figma_instances): cuántos son y el primero, como con los pasos
const STRING_LISTS: Readonly<
	Record<string, { readonly count: string; readonly first: string }>
> = {
	nodeIds: { count: "nodeIdCount", first: "firstNodeId" },
	pages: { count: "pageCount", first: "firstPage" },
	// figma_capture: las pantallas que se capturan
	screens: { count: "screenCount", first: "firstScreen" },
	// figma_build { areas }: las áreas cuyo plan se arma
	areas: { count: "areaCount", first: "firstArea" },
	// figma_build { sheets }: las hojas cuyo plan se arma
	sheets: { count: "sheetCount", first: "firstSheet" },
};

// figma_design_context: la variante pedida de un set, `{ propiedad: opción }`, como texto `propiedad=opción, …`
const VARIANT_KEY = "variant";

const clip = (text: string, max: number): string =>
	text.length > max ? `${text.slice(0, max)}${ELLIPSIS}` : text;

export function summarizeToolArgs(
	args: Readonly<Record<string, unknown>>,
	codePreviewChars: number,
): ArgsSummary {
	const summary: Record<string, string | number | boolean | null> = {};
	for (const [key, value] of Object.entries(args)) {
		if (key === STEPS_KEY && Array.isArray(value)) {
			summary["stepCount"] = value.length;
			const first: unknown = value[0];
			// Un paso del kit no tiene fichero: se resume por su etiqueta (`kit/place@1 · Panel`)
			const file =
				typeof first === "object" && first !== null && "file" in first
					? first.file
					: typeof first === "object" &&
							first !== null &&
							"use" in first &&
							typeof first.use === "string"
						? kitStepLabel(
								first.use as KitStep,
								"screen" in first && typeof first.screen === "string"
									? first.screen
									: "compose" in first && typeof first.compose === "string"
										? first.compose
										: "area" in first && typeof first.area === "string"
											? first.area
											: "",
							)
						: undefined;
			if (typeof file === "string")
				summary["firstFile"] = clip(file, MAX_ARG_CHARS);
		} else if (STRING_LISTS[key] !== undefined && Array.isArray(value)) {
			const names = STRING_LISTS[key];
			summary[names.count] = value.length;
			const first: unknown = value[0];
			if (typeof first === "string")
				summary[names.first] = clip(first, MAX_ARG_CHARS);
		} else if (
			key === VARIANT_KEY &&
			typeof value === "object" &&
			value !== null &&
			!Array.isArray(value)
		) {
			summary[key] = clip(
				Object.entries(value)
					.map(([prop, option]) => `${prop}=${String(option)}`)
					.join(", "),
				MAX_ARG_CHARS,
			);
		} else if (key === CODE_KEY && typeof value === "string") {
			summary["codeLength"] = value.length;
			summary["codePreview"] = value.slice(0, codePreviewChars);
		} else if (typeof value === "string") {
			summary[key] = clip(value, MAX_ARG_CHARS);
		} else if (
			typeof value === "number" ||
			typeof value === "boolean" ||
			value === null
		) {
			summary[key] = value;
		}
	}
	return summary;
}
