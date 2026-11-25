import { READ_KIND, variablesSummary } from "#domain/catalog.ts";
import { ok } from "#domain/result.ts";
import { type ReadDeps, type ReadRun, storeRead } from "./run-read.ts";

export type ReadVariablesInput = {
	// Nombre exacto de la colección
	readonly collection?: string | undefined;
	// Solo las variables ligadas en el subárbol de este nodo, y dónde
	readonly nodeId?: string | undefined;
};

// figma_variables (CA-1, CA-2): colecciones locales con modos, valores por modo y alias, siempre a fichero
export const makeReadVariables =
	(deps: ReadDeps) =>
	(input: ReadVariablesInput): Promise<ReadRun> =>
		deps.runRead(async () => {
			const read = await deps.reader.variables({
				collection: input.collection ?? null,
				nodeId: input.nodeId ?? null,
			});
			if (!read.ok) return read;
			return ok(
				await storeRead(
					deps,
					READ_KIND.variables,
					read.value,
					variablesSummary(read.value),
				),
			);
		});
