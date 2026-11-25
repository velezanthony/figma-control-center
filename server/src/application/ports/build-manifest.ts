import type { BuildPlan } from "#domain/build.ts";
import type { FigmaError } from "#domain/figma-error.ts";
import type { Result } from "#domain/result.ts";

// Lee y valida un manifiesto de lote (ruta) y devuelve un BuildPlan listo para ejecutar: cada paso con su
// `file` y sus `assets` ya resueltos y contenidos en las raíces, y sus `params` plegados (paso > manifiesto >
// llamada). Los `params` de la llamada (comunes a todo el lote) se pasan aquí para plegarlos al parsear, de
// forma que cada PlanStep ya trae sus params efectivos. Si algo falla, no devuelve nada (CA-6).
export interface BuildManifest {
	read(
		path: string,
		callParams?: Readonly<Record<string, unknown>>,
	): Promise<Result<BuildPlan, FigmaError>>;
}
