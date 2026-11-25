import type { FigmaError } from "#domain/figma-error.ts";
import type { Result } from "#domain/result.ts";

export interface ScriptRepository {
	read(path: string): Promise<Result<string, FigmaError>>;
	// El nombre con que el historial de intentos identifica al script: su ruta relativa a su raíz de scripts (la misma
	// carpeta en dos máquinas da el mismo nombre). Nunca falla: si no se puede resolver, devuelve la ruta tal cual
	identity(path: string): Promise<string>;
}
