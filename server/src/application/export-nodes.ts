import {
	type ExportedNode,
	type ExportFormat,
	exportSummary,
	READ_KIND,
} from "#domain/catalog.ts";
import { ok } from "#domain/result.ts";
import { type ReadDeps, type ReadRun, storeRead } from "./run-read.ts";

export type ExportNodesInput = {
	readonly nodeIds: readonly string[];
	readonly format: ExportFormat;
	readonly scale: number;
};

export type ExportNodesDeps = ReadDeps & {
	// FIGMA_EXPORT_MAX_NODES: nodos por llamada
	readonly maxNodes: number;
};

const tooMany = (count: number, max: number): string =>
	`figma_export admite como mucho ${max} nodos por llamada (FIGMA_EXPORT_MAX_NODES) y recibió ${count}: pártelo en varias llamadas o sube el tope en «Ajustes».`;

// figma_export (CA-6): un fichero por nodo en exports/ y el índice { nodeId, path, bytes, width?, height? }[] en reads/
export const makeExportNodes =
	(deps: ExportNodesDeps) =>
	async (input: ExportNodesInput): Promise<ReadRun> => {
		if (input.nodeIds.length > deps.maxNodes) {
			return {
				kind: "usage",
				message: tooMany(input.nodeIds.length, deps.maxNodes),
			};
		}
		return deps.runRead(async () => {
			const read = await deps.reader.export(input);
			if (!read.ok) return read;
			const at = deps.clock();
			const index: ExportedNode[] = [];
			for (const node of read.value) {
				const stored = await deps.store.saveExport(node.bytes, {
					nodeId: node.nodeId,
					format: input.format,
					at,
				});
				index.push({
					nodeId: node.nodeId,
					path: stored.path,
					bytes: stored.bytes,
					...(node.width !== undefined && { width: node.width }),
					...(node.height !== undefined && { height: node.height }),
				});
			}
			return ok(
				await storeRead(deps, READ_KIND.export, index, exportSummary(index)),
			);
		});
	};
