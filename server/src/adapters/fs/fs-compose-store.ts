// Los compose@1 de un proyecto: un `<clave>.json` por pantalla en la carpeta que declara
// `project@1.compose`. Se lee un fichero cada vez y se valida contra el esquema: uno roto no estorba a los demás.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	ComposeSchema,
	composeSchemaIssues,
} from "#adapters/contracts/compose.ts";
import type {
	ComposeRead,
	ComposeStore,
} from "#application/ports/compose-store.ts";
import { COMPOSE_KEY_PATTERN } from "#domain/compose.ts";
import { composeContractError } from "#domain/figma-error.ts";

export class FsComposeStore implements ComposeStore {
	async read(dir: string, key: string): Promise<ComposeRead> {
		if (!COMPOSE_KEY_PATTERN.test(key)) {
			return {
				kind: "usage",
				message: `«${key}» no es una clave de compose válida: letras, cifras, «-» y «_», sin barras ni puntos (es el nombre del fichero <clave>.json).`,
			};
		}
		const path = join(dir, `${key}.json`);
		let text: string;
		try {
			text = await readFile(path, "utf8");
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === "ENOENT") {
				return { kind: "missing", path };
			}
			throw e;
		}
		let value: unknown;
		try {
			value = JSON.parse(text);
		} catch (e) {
			return {
				kind: "error",
				error: composeContractError(path, [
					{
						pointer: "",
						message: `no es JSON (${e instanceof Error ? e.message : String(e)})`,
					},
				]),
			};
		}
		const issues = composeSchemaIssues(value);
		if (issues.length > 0) {
			return { kind: "error", error: composeContractError(path, issues) };
		}
		const compose = ComposeSchema.parse(value);
		if (compose.key !== key) {
			return {
				kind: "error",
				error: composeContractError(path, [
					{
						pointer: "/key",
						message: `la clave «${compose.key}» no es la del fichero («${key}»): tienen que coincidir.`,
					},
				]),
			};
		}
		return { kind: "ok", compose, path, text };
	}
}
