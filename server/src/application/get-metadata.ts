import type { FigmaError } from "#domain/figma-error.ts";
import type { Result } from "#domain/result.ts";
import type { FigmaGateway, MetadataNode } from "./ports/figma-gateway.ts";

// nodeId null = página actual
export const makeGetMetadata =
	(gateway: FigmaGateway) =>
	(
		nodeId: string | null,
		depth: number,
	): Promise<Result<MetadataNode, FigmaError>> =>
		gateway.metadata(nodeId, depth);
