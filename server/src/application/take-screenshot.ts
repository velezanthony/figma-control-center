import type { FigmaError } from "#domain/figma-error.ts";
import { err, ok, type Result } from "#domain/result.ts";
import type { FigmaGateway } from "./ports/figma-gateway.ts";
import type { ResultStore } from "./ports/result-store.ts";

export type ScreenshotFile = {
	readonly path: string;
	readonly bytes: number;
	readonly width: number;
	readonly height: number;
};

export const makeTakeScreenshot =
	(deps: {
		readonly gateway: FigmaGateway;
		readonly store: ResultStore;
		readonly now: () => Date;
	}) =>
	async (
		nodeId: string,
		scale: number,
	): Promise<Result<ScreenshotFile, FigmaError>> => {
		const shot = await deps.gateway.screenshot(nodeId, scale);
		if (!shot.ok) return err(shot.error);
		const stored = await deps.store.savePng(shot.value.png, {
			nodeId,
			at: deps.now(),
		});
		return ok({
			path: stored.path,
			bytes: stored.bytes,
			width: shot.value.width,
			height: shot.value.height,
		});
	};
