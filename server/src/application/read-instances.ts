import { instancesSummary, READ_KIND } from "#domain/catalog.ts";
import { ok } from "#domain/result.ts";
import { type ReadDeps, type ReadRun, storeRead } from "./run-read.ts";

export type ReadInstancesInput = {
	// Nombres exactos de las páginas (al menos una)
	readonly pages: readonly string[];
	// Solo el frame de primer nivel con este nombre
	readonly frame?: string | undefined;
};

// figma_instances (CA-5): instancias por frame de primer nivel, por nombre de set o de componente, a fichero
export const makeReadInstances =
	(deps: ReadDeps) =>
	(input: ReadInstancesInput): Promise<ReadRun> =>
		deps.runRead(async () => {
			const read = await deps.reader.instances({
				pages: input.pages,
				frame: input.frame ?? null,
			});
			if (!read.ok) return read;
			return ok(
				await storeRead(
					deps,
					READ_KIND.instances,
					{ frames: read.value },
					instancesSummary(read.value),
				),
			);
		});
