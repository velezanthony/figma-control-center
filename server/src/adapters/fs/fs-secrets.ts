// Los secretos de la captura de la web: FCC_WEB_SECRETS_FILE, un fichero de la máquina
// fuera de todo repo con `{ <secretRef>: <valor> }`. Se lee al pedir, en memoria; ningún valor sale de aquí salvo como
// resultado y nada se escribe por stderr. El arnés deniega este fichero al agente (domain/agent-harness.ts).
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { SecretStore } from "#application/ports/secrets.ts";
import { type FigmaError, secretMissing } from "#domain/figma-error.ts";
import { err, ok, type Result } from "#domain/result.ts";

const SecretsFileSchema = z.record(z.string().min(1), z.string());

export class FsSecretStore implements SecretStore {
	readonly #file: string;

	constructor(file: string) {
		this.#file = file;
	}

	async resolve(
		refs: readonly string[],
	): Promise<Result<ReadonlyMap<string, string>, FigmaError>> {
		if (refs.length === 0) return ok(new Map());
		const first = refs[0] as string;
		let text: string;
		try {
			text = await readFile(this.#file, "utf8");
		} catch {
			return err(
				secretMissing(
					first,
					this.#file,
					"el fichero de secretos no existe o no se puede leer",
				),
			);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return err(
				secretMissing(first, this.#file, "el fichero de secretos no es JSON"),
			);
		}
		const secrets = SecretsFileSchema.safeParse(parsed);
		if (!secrets.success)
			return err(
				secretMissing(
					first,
					this.#file,
					"el fichero de secretos no es un objeto { nombre: texto }",
				),
			);
		const values = new Map<string, string>();
		for (const ref of refs) {
			const value = secrets.data[ref];
			if (value === undefined) return err(secretMissing(ref, this.#file));
			values.set(ref, value);
		}
		return ok(values);
	}
}
