// Un asset (bytes) como objeto: los datos van por assets, no pegados dentro del script
import { fail } from "./core.ts";

export function readJson(bytes: Uint8Array): unknown {
	try {
		return JSON.parse(new TextDecoder().decode(bytes));
	} catch (e) {
		return fail(
			"BAD_JSON",
			`El asset no es JSON: ${e instanceof Error ? e.message : String(e)}`,
			"Comprueba el fichero que pasas en `assets`.",
		);
	}
}
