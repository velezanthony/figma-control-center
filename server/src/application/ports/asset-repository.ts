import type { AssetRecord } from "#domain/attempt.ts";
import type { FigmaError } from "#domain/figma-error.ts";
import type { Result } from "#domain/result.ts";

// Lee los bytes de los assets de una llamada o un paso (nombre → ruta), todos dentro de las raíces permitidas.
// El total de bytes no puede pasar del tope (FCC_MAX_ASSET_BYTES); si algo falla, no se lee nada.
export interface AssetRepository {
	// Comprueba lo mismo que `read` (existencia, raíces, tope) sin cargar los bytes: es la validación previa de un lote
	check(
		paths: Readonly<Record<string, string>>,
	): Promise<Result<void, FigmaError>>;
	read(
		paths: Readonly<Record<string, string>>,
	): Promise<Result<Readonly<Record<string, Uint8Array>>, FigmaError>>;
	// Nombre, ruta relativa a su raíz, tamaño y sha256 de cada asset, para el historial de intentos (los bytes no se
	// copian). Nunca falla: el asset que no se puede leer se omite
	describe(
		paths: Readonly<Record<string, string>>,
	): Promise<readonly AssetRecord[]>;
}
