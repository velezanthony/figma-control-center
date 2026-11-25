import { READ_KIND, type StyleKind, stylesSummary } from "#domain/catalog.ts";
import { ok } from "#domain/result.ts";
import { type ReadDeps, type ReadRun, storeRead } from "./run-read.ts";

export type ReadStylesInput = { readonly kind?: StyleKind | undefined };

// figma_styles (CA-3): estilos locales por tipo con sus variables ligadas, siempre a fichero
export const makeReadStyles =
	(deps: ReadDeps) =>
	(input: ReadStylesInput): Promise<ReadRun> =>
		deps.runRead(async () => {
			const read = await deps.reader.styles(input.kind ?? null);
			if (!read.ok) return read;
			return ok(
				await storeRead(
					deps,
					READ_KIND.styles,
					{ styles: read.value },
					stylesSummary(read.value),
				),
			);
		});
