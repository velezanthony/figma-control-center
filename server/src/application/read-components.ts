import { componentsSummary, READ_KIND } from "#domain/catalog.ts";
import { ok } from "#domain/result.ts";
import { type ReadDeps, type ReadRun, storeRead } from "./run-read.ts";

export type ReadComponentsInput = {
	// Nombre exacto de la página
	readonly page?: string | undefined;
	// Texto que debe aparecer en el nombre
	readonly query?: string | undefined;
};

// figma_components (CA-4): sets y componentes sueltos con página, descripción, variantes y propiedades, a fichero
export const makeReadComponents =
	(deps: ReadDeps) =>
	(input: ReadComponentsInput): Promise<ReadRun> =>
		deps.runRead(async () => {
			const read = await deps.reader.components({
				page: input.page ?? null,
				query: input.query ?? null,
			});
			if (!read.ok) return read;
			return ok(
				await storeRead(
					deps,
					READ_KIND.components,
					{ components: read.value },
					componentsSummary(read.value),
				),
			);
		});
