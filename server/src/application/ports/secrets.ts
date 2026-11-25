import type { FigmaError } from "#domain/figma-error.ts";
import type { Result } from "#domain/result.ts";

// Los valores de los secretRef de una captura: se resuelven en memoria, solo en el servidor,
// antes de lanzar Chrome. Un secretRef sin valor es SecretMissing. Nadie registra ni devuelve un valor fuera de aquí
export interface SecretStore {
	resolve(
		refs: readonly string[],
	): Promise<Result<ReadonlyMap<string, string>, FigmaError>>;
}
