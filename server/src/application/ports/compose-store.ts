import type { ComposeFile } from "#domain/compose.ts";
import type { FigmaError } from "#domain/figma-error.ts";

// Lo que da leer un compose@1 de la carpeta del proyecto
export type ComposeRead =
	| {
			readonly kind: "ok";
			readonly compose: ComposeFile;
			// Ruta real del fichero y su texto (el historial de intentos guarda el compose tal como estaba)
			readonly path: string;
			readonly text: string;
	  }
	// No hay `<clave>.json` en la carpeta
	| { readonly kind: "missing"; readonly path: string }
	// La clave pedida no es una clave válida de compose: no se llegó a mirar el disco
	| { readonly kind: "usage"; readonly message: string }
	// El fichero no es JSON o no cumple compose@1 (ContractError con el puntero del primer fallo)
	| { readonly kind: "error"; readonly error: FigmaError };

export interface ComposeStore {
	read(dir: string, key: string): Promise<ComposeRead>;
}
